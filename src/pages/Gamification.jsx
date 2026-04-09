import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchSessionRosterWithStudents } from "../lib/sessionRoster";
import { fmtRun } from "../lib/scores";
import { SitupsIcon, BroadJumpIcon, ReachIcon, PullupsIcon, PushupsIcon, ShuttleIcon } from "../components/icons/StationIcons";
import { evaluateNapfa, normalizeSex } from "../utils/napfaStandards";
import { evaluateIppt3 } from "../utils/ippt3Standards";

function calcAgeAt(dobISO, when) {
  if (!dobISO) return null;
  try {
    const birth = new Date(dobISO);
    const d = when instanceof Date ? when : new Date(when);
    let age = d.getFullYear() - birth.getFullYear();
    const m = d.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && d.getDate() < birth.getDate())) age--;
    return age;
  } catch { return null; }
}

function formatValue(key, val) {
  if (val == null) return "-";
  if (key === "run_2400") return fmtRun(val) || "-";
  if (key === "shuttle_run") return Number.isFinite(val) ? `${Number(val).toFixed(1)}s` : "-";
  return String(val);
}

function bestWithNext(items, lowerBetter) {
  const clean = items.filter(i => i.value != null && Number.isFinite(i.value));
  if (clean.length === 0) return null;
  const sorted = clean.sort((a,b) => lowerBetter ? a.value - b.value : b.value - a.value);
  const best = sorted[0];
  const next = sorted[1];
  return { best, next };
}

function hasValue(v) {
  return v != null && Number.isFinite(Number(v));
}

function formatAverageValue(key, val) {
  if (val == null || !Number.isFinite(Number(val))) return "-";
  const n = Number(val);
  if (key === "shuttle_run") return `${n.toFixed(1)}s`;
  if (key === "broad_jump" || key === "sit_and_reach") return `${n.toFixed(1)} cm`;
  if (key === "run_2400") return fmtRun(n) || "-";
  return `${n.toFixed(1)} reps`;
}

function gradeToRank(g) {
  if (!g) return 0;
  const t = String(g).toUpperCase();
  return t === "A" ? 5 : t === "B" ? 4 : t === "C" ? 3 : t === "D" ? 2 : t === "E" ? 1 : 0;
}

function computeNapfaAwardLabel(res) {
  const st = res?.stations || {};
  const grades = [st.situps?.grade, st.broad_jump_cm?.grade, st.sit_and_reach_cm?.grade, st.pullups?.grade, st.shuttle_s?.grade, st.run?.grade];
  if (grades.some((g) => !g)) return "No Award";
  const total = res?.totalPoints || 0;
  const minRank = Math.min(...grades.map(gradeToRank));
  if (total >= 21 && minRank >= gradeToRank("C")) return "Gold";
  if (total >= 15 && minRank >= gradeToRank("D")) return "Silver";
  if (total >= 6 && minRank >= gradeToRank("E")) return "Bronze";
  return "No Award";
}

function computeNapfaProvisionalAwardLabel(res) {
  const st = res?.stations || {};
  const grades = [st.situps?.grade, st.broad_jump_cm?.grade, st.sit_and_reach_cm?.grade, st.pullups?.grade, st.shuttle_s?.grade];
  if (grades.some((g) => !g)) return "No Award";
  const total = (st.situps?.points || 0)
    + (st.broad_jump_cm?.points || 0)
    + (st.sit_and_reach_cm?.points || 0)
    + (st.pullups?.points || 0)
    + (st.shuttle_s?.points || 0);
  const minRank = Math.min(...grades.map(gradeToRank));
  if (total >= 21 && minRank >= gradeToRank("C")) return "Gold";
  if (total >= 15 && minRank >= gradeToRank("D")) return "Silver";
  if (total >= 6 && minRank >= gradeToRank("E")) return "Bronze";
  return "No Award";
}

function normalizeAchievementAward(label) {
  const raw = String(label || "").trim();
  if (raw === "Pass") return "Bronze";
  return raw || "No Award";
}

export default function Gamification({ user }) {
  const SCORE_POLL_MS = 10_000;
  const [membership, setMembership] = useState(null);
  const [schoolType, setSchoolType] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState(null);
  const [roster, setRoster] = useState([]);
  const [scoresMap, setScoresMap] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [groupBy, setGroupBy] = useState("class");
  const [leaderboardMode, setLeaderboardMode] = useState("detailed");
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const scorePollTimeoutRef = useRef(null);
  const scoreRefreshInFlightRef = useRef(false);
  const sessionAssessmentType = session?.assessment_type || "NAPFA5";

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        if (!user?.id) return;
        const { data: mem } = await supabase
          .from("memberships")
          .select("school_id, role")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!ignore) setMembership(mem || null);
        if (mem?.school_id) {
          const { data: sch } = await supabase
            .from("schools")
            .select("type")
            .eq("id", mem.school_id)
            .maybeSingle();
          if (!ignore) setSchoolType(sch?.type || null);
          const { data: sess } = await supabase
            .from("sessions")
            .select("id, title, session_date, status, assessment_type")
            .eq("school_id", mem.school_id)
            .order("session_date", { ascending: false });
          if (!ignore) setSessions(sess || []);
        }
      } catch {}
    };
    load();
    return () => { ignore = true; };
  }, [user?.id]);

  const refreshScores = useCallback(async (targetSessionId, assessmentType) => {
    const table = assessmentType === "IPPT3" ? "ippt3_scores" : "scores";
    const selectFields = table === "ippt3_scores"
      ? "student_id,situps,pushups,run_2400"
      : "student_id,situps,broad_jump,sit_and_reach,pullups,shuttle_run,run_2400";
    const { data } = await supabase
      .from(table)
      .select(selectFields)
      .eq("session_id", targetSessionId);
    return new Map((data || []).map((row) => [row.student_id, row]));
  }, []);

  const refreshCurrentScores = useCallback(async () => {
    if (!sessionId || !session || session.id !== sessionId) return;
    if (scoreRefreshInFlightRef.current) return;
    scoreRefreshInFlightRef.current = true;
    setRefreshingScores(true);
    try {
      const data = await refreshScores(sessionId, sessionAssessmentType);
      setScoresMap(data);
    } finally {
      scoreRefreshInFlightRef.current = false;
      setRefreshingScores(false);
    }
  }, [refreshScores, sessionAssessmentType, sessionId, session]);

  useEffect(() => {
    let ignore = false;
    const loadSession = async () => {
      if (!sessionId) { setSession(null); setRoster([]); setScoresMap(new Map()); setNextRefreshIn(null); return; }
      setSession(null);
      setRoster([]);
      setScoresMap(new Map());
      setNextRefreshIn(null);
      setLoading(true);
      try {
        const { data: sess } = await supabase
          .from("sessions")
          .select("*")
          .eq("id", sessionId)
          .maybeSingle();
        if (!ignore) setSession(sess || null);
        const sessionYear = sess?.session_date ? new Date(sess.session_date).getFullYear() : null;
        const rRows = await fetchSessionRosterWithStudents(supabase, sessionId, {
          includeHouse: true,
          sessionYear,
          studentFields: ["id", "name", "gender", "dob"],
        });
        const list = (rRows || []).map(r => {
          const s = r.students || {};
          return { id: s.id, name: s.name, gender: s.gender, dob: s.dob, class: r.class || "", house: r.house || "" };
        });
        const map = await refreshScores(sessionId, sess?.assessment_type || "NAPFA5");
        if (!ignore) {
          setRoster(list);
          setScoresMap(map);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    loadSession();
    return () => { ignore = true; };
  }, [refreshScores, sessionId]);

  useEffect(() => {
    if (!sessionId || !session || session.id !== sessionId) {
      setNextRefreshIn(null);
      clearTimeout(scorePollTimeoutRef.current);
      return;
    }

    let cancelled = false;
    let nextRefreshAt = Date.now() + SCORE_POLL_MS;

    const syncCountdown = () => {
      const secondsLeft = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
      setNextRefreshIn(secondsLeft);
    };

    const schedulePoll = (delayMs = SCORE_POLL_MS) => {
      clearTimeout(scorePollTimeoutRef.current);
      nextRefreshAt = Date.now() + delayMs;
      syncCountdown();
      scorePollTimeoutRef.current = setTimeout(async () => {
        if (cancelled) return;
        if (!sessionId || !session || session.id !== sessionId) return;
        if (document.visibilityState !== "visible" || scoreRefreshInFlightRef.current) {
          schedulePoll(1_000);
          return;
        }
        try {
          await refreshCurrentScores();
          if (!cancelled) schedulePoll(SCORE_POLL_MS);
        } catch {
          if (!cancelled) schedulePoll(SCORE_POLL_MS * 2);
        }
      }, delayMs);
    };

    const countdownId = setInterval(syncCountdown, 1000);
    schedulePoll();

    return () => {
      cancelled = true;
      clearInterval(countdownId);
      clearTimeout(scorePollTimeoutRef.current);
      setNextRefreshIn(null);
    };
  }, [refreshCurrentScores, sessionId, session?.id]);

  const stations = useMemo(() => {
    if ((session?.assessment_type || "NAPFA5") === "IPPT3") {
      return [
        { key: "situps", label: "Sit-ups", lowerBetter: false, Icon: SitupsIcon },
        { key: "pushups", label: "Push-ups", lowerBetter: false, Icon: PushupsIcon },
        { key: "run_2400", label: "2.4km Run", lowerBetter: true, Icon: ShuttleIcon },
      ];
    }
    return [
      { key: "situps", label: "Sit-ups", lowerBetter: false, Icon: SitupsIcon },
      { key: "broad_jump", label: "Broad Jump", lowerBetter: false, Icon: BroadJumpIcon },
      { key: "sit_and_reach", label: "Sit & Reach", lowerBetter: false, Icon: ReachIcon },
      { key: "pullups", label: "Pull-ups", lowerBetter: false, Icon: PullupsIcon },
      { key: "shuttle_run", label: "Shuttle Run", lowerBetter: true, Icon: ShuttleIcon },
      { key: "run_2400", label: "Run", lowerBetter: true, Icon: ShuttleIcon },
    ];
  }, [session?.assessment_type]);

  const pbCards = useMemo(() => {
    return stations.map(st => {
      const items = roster.map(r => {
        const row = scoresMap.get(r.id) || {};
        const value = row[st.key];
        const sex = normalizeSex(r.gender);
        const gender = sex === "Male" ? "M" : sex === "Female" ? "F" : "U";
        return { student: r, value, gender };
      });
      const byGender = { M: [], F: [], U: [] };
      items.forEach(i => { byGender[i.gender]?.push(i); });
      return {
        station: st,
        resByGender: {
          M: bestWithNext(byGender.M, st.lowerBetter),
          F: bestWithNext(byGender.F, st.lowerBetter),
          U: bestWithNext(byGender.U, st.lowerBetter),
        },
      };
    });
  }, [stations, roster, scoresMap]);

  const groupLabel = groupBy === "house" ? "House" : "Class";

  const groupStats = useMemo(() => {
    const isIppt3 = (session?.assessment_type || "NAPFA5") === "IPPT3";
    if (!session || roster.length === 0) return [];
    const requiredFields = isIppt3
      ? ["situps", "pushups", "run_2400"]
      : ["situps", "broad_jump", "sit_and_reach", "pullups", "shuttle_run", "run_2400"];
    const napfaCoreFields = ["situps", "broad_jump", "sit_and_reach", "pullups", "shuttle_run"];
    const testDate = session?.session_date ? new Date(session.session_date) : new Date();
    const level = String(schoolType || "").toLowerCase() === "primary" ? "Primary" : "Secondary";
    const byGroup = new Map();
    const studentTotals = [];
    const stationLeadsByGroup = new Map();

    for (const st of stations) {
      let best = null;
      for (const r of roster) {
        const row = scoresMap.get(r.id) || {};
        const val = row[st.key];
        if (!hasValue(val)) continue;
        const key = groupBy === "house" ? (r.house || "Unassigned") : (r.class || "Unassigned");
        if (!best) {
          best = { key, value: Number(val) };
          continue;
        }
        const better = st.lowerBetter ? Number(val) < best.value : Number(val) > best.value;
        if (better) best = { key, value: Number(val) };
      }
      if (best) stationLeadsByGroup.set(best.key, (stationLeadsByGroup.get(best.key) || 0) + 1);
    }

    roster.forEach(r => {
      const row = scoresMap.get(r.id) || {};
      const sex = normalizeSex(r.gender);
      const age = calcAgeAt(r.dob, testDate);
      let total = 0;
      if (sex && age != null) {
        if (isIppt3) {
          const measures = {};
          if (row.situps != null) measures.situps = Number(row.situps);
          if (row.pushups != null) measures.pushups = Number(row.pushups);
          if (row.run_2400 != null) measures.run_seconds = Math.round(Number(row.run_2400) * 60);
          const res = evaluateIppt3({ sex, age }, measures);
          total = res?.totalPoints || 0;
        } else {
          const runKm = age >= 14 ? 2.4 : (level === "Primary" ? 1.6 : 2.4);
          const measures = {
            situps: row.situps,
            broad_jump_cm: row.broad_jump,
            sit_and_reach_cm: row.sit_and_reach,
            pullups: row.pullups,
            shuttle_s: row.shuttle_run,
            run_seconds: row.run_2400 != null ? Math.round(Number(row.run_2400) * 60) : null,
          };
          const res = evaluateNapfa({ level, sex, age, run_km: runKm }, measures);
          total = res?.totalPoints || 0;
        }
      }
      const key = groupBy === "house" ? (r.house || "Unassigned") : (r.class || "Unassigned");
      if (!byGroup.has(key)) {
        byGroup.set(key, {
          cls: key,
          buckets: { M: [], F: [], U: [] },
          totals: { M: 0, F: 0, U: 0, all: 0 },
          awardEligibleCount: 0,
          bronzePlusCount: 0,
          silverPlusCount: 0,
          goldCount: 0,
          genderStationPoints: {
            M: { sum: 0, count: 0 },
            F: { sum: 0, count: 0 },
          },
          members: 0,
          completionSum: 0,
          completedMembers: 0,
          totalPointsSum: 0,
          scoredCount: 0,
        });
      }
      const entry = byGroup.get(key);
      entry.members += 1;
      const doneCount = requiredFields.reduce((acc, f) => acc + (hasValue(row[f]) ? 1 : 0), 0);
      const completionRate = requiredFields.length ? doneCount / requiredFields.length : 0;
      entry.completionSum += completionRate;
      if (completionRate === 1) entry.completedMembers += 1;

      const genderKey = sex === "Male" ? "M" : sex === "Female" ? "F" : "U";
      entry.buckets[genderKey].push({ student: r, total });
      entry.totals[genderKey] += Number(total) || 0;
      entry.totals.all += Number(total) || 0;
      if (sex && age != null) {
        entry.totalPointsSum += Number(total) || 0;
        entry.scoredCount += 1;
        studentTotals.push({ groupKey: key, total: Number(total) || 0 });
      }

      if (genderKey === "M" || genderKey === "F") {
        if (isIppt3) {
          const measures = {};
          if (hasValue(row.situps)) measures.situps = Number(row.situps);
          if (hasValue(row.pushups)) measures.pushups = Number(row.pushups);
          if (hasValue(row.run_2400)) measures.run_seconds = Math.round(Number(row.run_2400) * 60);
          const res = evaluateIppt3({ sex, age }, measures);
          if (hasValue(row.situps)) {
            entry.genderStationPoints[genderKey].sum += res?.stations?.situps?.points || 0;
            entry.genderStationPoints[genderKey].count += 1;
          }
          if (hasValue(row.pushups)) {
            entry.genderStationPoints[genderKey].sum += res?.stations?.pushups?.points || 0;
            entry.genderStationPoints[genderKey].count += 1;
          }
          if (hasValue(row.run_2400)) {
            entry.genderStationPoints[genderKey].sum += res?.stations?.run?.points || 0;
            entry.genderStationPoints[genderKey].count += 1;
          }
        } else {
          const runKm = age >= 14 ? 2.4 : (level === "Primary" ? 1.6 : 2.4);
          const measures = {};
          if (hasValue(row.situps)) measures.situps = Number(row.situps);
          if (hasValue(row.broad_jump)) measures.broad_jump_cm = Number(row.broad_jump);
          if (hasValue(row.sit_and_reach)) measures.sit_and_reach_cm = Number(row.sit_and_reach);
          if (hasValue(row.pullups)) measures.pullups = Number(row.pullups);
          if (hasValue(row.shuttle_run)) measures.shuttle_s = Number(row.shuttle_run);
          if (hasValue(row.run_2400)) measures.run_seconds = Math.round(Number(row.run_2400) * 60);
          const res = evaluateNapfa({ level, sex, age, run_km: runKm }, measures);
          const stationKeys = ["situps", "broad_jump_cm", "sit_and_reach_cm", "pullups", "shuttle_s", "run"];
          stationKeys.forEach((stationKey) => {
            const pts = res?.stations?.[stationKey]?.points;
            if (pts != null) {
              entry.genderStationPoints[genderKey].sum += Number(pts) || 0;
              entry.genderStationPoints[genderKey].count += 1;
            }
          });
        }
      }

      const napfaCoreDoneCount = napfaCoreFields.reduce((acc, f) => acc + (hasValue(row[f]) ? 1 : 0), 0);
      const qualifiesForAchievementAward = isIppt3
        ? doneCount === requiredFields.length
        : napfaCoreDoneCount === napfaCoreFields.length;

      if (qualifiesForAchievementAward && sex && age != null) {
        let awardLabel = "No Award";
        if (isIppt3) {
          const measures = {
            situps: Number(row.situps),
            pushups: Number(row.pushups),
            run_seconds: Math.round(Number(row.run_2400) * 60),
          };
          const res = evaluateIppt3({ sex, age }, measures);
          awardLabel = normalizeAchievementAward(res?.award);
        } else {
          const runKm = age >= 14 ? 2.4 : (level === "Primary" ? 1.6 : 2.4);
          const measures = {
            situps: Number(row.situps),
            broad_jump_cm: Number(row.broad_jump),
            sit_and_reach_cm: Number(row.sit_and_reach),
            pullups: Number(row.pullups),
            shuttle_s: Number(row.shuttle_run),
          };
          if (hasValue(row.run_2400)) measures.run_seconds = Math.round(Number(row.run_2400) * 60);
          const res = evaluateNapfa({ level, sex, age, run_km: runKm }, measures);
          awardLabel = hasValue(row.run_2400) ? computeNapfaAwardLabel(res) : computeNapfaProvisionalAwardLabel(res);
        }
        entry.awardEligibleCount += 1;
        if (awardLabel === "Bronze" || awardLabel === "Silver" || awardLabel === "Gold") entry.bronzePlusCount += 1;
        if (awardLabel === "Silver" || awardLabel === "Gold") entry.silverPlusCount += 1;
        if (awardLabel === "Gold") entry.goldCount += 1;
      }
    });
    const top3 = [...studentTotals].sort((a, b) => b.total - a.total).slice(0, 3);
    const top3ByGroup = new Map();
    top3.forEach(x => top3ByGroup.set(x.groupKey, (top3ByGroup.get(x.groupKey) || 0) + 1));

    const rows = Array.from(byGroup.values()).map(c => {
      const sortTop = (list) => [...list].sort((a,b) => (b.total||0) - (a.total||0)).slice(0, 5);
      const avgCompletion = c.members ? c.completionSum / c.members : 0;
      const avgTotal = c.scoredCount ? c.totalPointsSum / c.scoredCount : 0;
      const stationLeads = stationLeadsByGroup.get(c.cls) || 0;
      return {
        ...c,
        buckets: { M: sortTop(c.buckets.M), F: sortTop(c.buckets.F), U: sortTop(c.buckets.U) },
        avgCompletion,
        avgTotal,
        stationLeads,
        top3Count: top3ByGroup.get(c.cls) || 0,
      };
    });

    const maxAvgTotal = rows.reduce((m, r) => Math.max(m, r.avgTotal || 0), 0);
    const ranked = [...rows].sort((a, b) => b.avgTotal - a.avgTotal);
    const rankMap = new Map(ranked.map((r, i) => [r.cls, i + 1]));
    const groupLabelLocal = groupBy === "house" ? "House" : "Class";

    return rows
      .map(c => {
        const normTotal = maxAvgTotal > 0 ? c.avgTotal / maxAvgTotal : 0;
        const challengeScore = Math.round((c.avgCompletion * 60) + (normTotal * 30) + (Math.min(c.stationLeads, 3) * 5));
        const targets = {
          completeCircuit: 0.9,
          top3Push: 1,
          stationSweep: 2,
        };
        const progress = {
          completeCircuit: c.avgCompletion,
          top3Push: c.top3Count,
          stationSweep: c.stationLeads,
        };

        const badges = [];
        if (rankMap.get(c.cls) === 1) badges.push({ key: "champion", name: `${groupLabelLocal} Champion`, desc: "Highest average points in this session." });
        if (c.avgCompletion >= 0.9) badges.push({ key: "completion", name: `${groupLabelLocal} Completion Masters`, desc: `90%+ station completion across ${groupLabelLocal.toLowerCase()} roster.` });
        if (c.stationLeads >= 2) badges.push({ key: "station", name: "Station Strikers", desc: "Leads at least 2 station leaderboards." });
        if (c.top3Count >= 1) badges.push({ key: "podium", name: "Podium Presence", desc: "At least one student in session top 3 totals." });
        if (c.scoredCount >= Math.ceil(c.members * 0.85)) badges.push({ key: "participation", name: `${groupLabelLocal} High Participation`, desc: "85%+ students have scores recorded." });
        if (badges.length === 0) badges.push({ key: "momentum", name: "Momentum Builders", desc: `Keep recording scores to unlock ${groupLabelLocal.toLowerCase()} badges.` });

        return {
          ...c,
          challengeScore,
          badges,
          targets,
          progress,
        };
      })
      .sort((a, b) => b.challengeScore - a.challengeScore || b.avgTotal - a.avgTotal);
  }, [groupBy, roster, scoresMap, session, schoolType, stations]);

  const badgeShowcase = useMemo(() => {
    const formatPct = (count, total) => total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
    const avgStationPoints = (bucket) => (bucket?.count ? (bucket.sum / bucket.count) : null);
    const items = [
      {
        key: "bronze-builders",
        name: "Bronze Builders",
        imageSrc: "/bronze-medal.png",
        desc: `40% of ${groupLabel.toLowerCase()} students achieved Bronze or above.`,
        qualifiers: groupStats
          .filter((g) => g.awardEligibleCount > 0 && (g.bronzePlusCount / g.awardEligibleCount) >= 0.4)
          .map((g) => ({
            group: g.cls,
            detail: `${g.bronzePlusCount}/${g.awardEligibleCount} students`,
            metric: formatPct(g.bronzePlusCount, g.awardEligibleCount),
          })),
      },
      {
        key: "silver-surge",
        name: "Silver Surge",
        imageSrc: "/silver-medal.png",
        desc: `20% of ${groupLabel.toLowerCase()} students achieved Silver or above.`,
        qualifiers: groupStats
          .filter((g) => g.awardEligibleCount > 0 && (g.silverPlusCount / g.awardEligibleCount) >= 0.2)
          .map((g) => ({
            group: g.cls,
            detail: `${g.silverPlusCount}/${g.awardEligibleCount} students`,
            metric: formatPct(g.silverPlusCount, g.awardEligibleCount),
          })),
      },
      {
        key: "gold-class",
        name: "Gold Class",
        imageSrc: "/gold-medal.png",
        desc: `10% of ${groupLabel.toLowerCase()} students achieved Gold.`,
        qualifiers: groupStats
          .filter((g) => g.awardEligibleCount > 0 && (g.goldCount / g.awardEligibleCount) >= 0.1)
          .map((g) => ({
            group: g.cls,
            detail: `${g.goldCount}/${g.awardEligibleCount} students`,
            metric: formatPct(g.goldCount, g.awardEligibleCount),
          })),
      },
      {
        key: "balanced-squad",
        name: "Balanced Squad",
        imageSrc: "/balance.png",
        desc: "Average boys and girls station points are both at least 2.5.",
        qualifiers: groupStats
          .filter((g) => {
            const boysAvg = avgStationPoints(g.genderStationPoints?.M);
            const girlsAvg = avgStationPoints(g.genderStationPoints?.F);
            return Number.isFinite(boysAvg) && Number.isFinite(girlsAvg) && boysAvg >= 2.5 && girlsAvg >= 2.5;
          })
          .map((g) => ({
            group: g.cls,
            detail: `Boys ${avgStationPoints(g.genderStationPoints?.M)?.toFixed(1)} · Girls ${avgStationPoints(g.genderStationPoints?.F)?.toFixed(1)}`,
            metric: "Unlocked",
          })),
      },
    ];
    return items;
  }, [groupLabel, groupStats]);

  const classLeaderboards = useMemo(() => {
    return groupStats
      .map(g => ({
        cls: g.cls,
        buckets: g.buckets,
        totals: g.totals,
        avgCompletion: g.avgCompletion,
        avgTotal: g.avgTotal,
        stationLeads: g.stationLeads,
      }))
      .sort((a, b) => (b.totals?.all ?? 0) - (a.totals?.all ?? 0) || (b.avgTotal ?? 0) - (a.avgTotal ?? 0));
  }, [groupStats]);

  return (
    <main className="w-full">
      <div className="fixed bottom-4 right-4 z-30">
        <div className="rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm text-slate-600 shadow-lg backdrop-blur">
          {sessionId
            ? (refreshingScores ? "Refreshing scores..." : `Next refresh in ${nextRefreshIn ?? Math.ceil(SCORE_POLL_MS / 1000)}s`)
            : "Select a session"}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Challenge Hub</h1>
          <p className="text-sm text-gray-600">Gamified insights to motivate higher performance.</p>
        </header>

        <section className="border rounded-lg p-3 bg-white shadow-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-gray-600">Session</label>
            <select
              className="border rounded px-2 py-1 text-sm bg-white"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">Select a session</option>
              {(sessions || []).map(s => (
                <option key={s.id} value={s.id}>
                  {s.title || "Untitled"} ({s.session_date})
                </option>
              ))}
            </select>
            <label className="text-sm text-gray-600 ml-auto">Group by</label>
            <select
              className="border rounded px-2 py-1 text-sm bg-white"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              <option value="class">Class</option>
              <option value="house">House</option>
            </select>
            <button
              type="button"
              className="border rounded px-3 py-1 text-sm bg-white hover:bg-slate-50 disabled:opacity-60"
              onClick={() => refreshCurrentScores()}
              disabled={!sessionId || refreshingScores}
            >
              {refreshingScores ? "Refreshing..." : "Refresh now"}
            </button>
          </div>
        </section>

        {loading && (
          <div className="text-sm text-gray-600">Loading session data...</div>
        )}

        {!loading && session && (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold">{groupLabel} Leaderboards</h2>
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 ${leaderboardMode === "simple" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                    onClick={() => setLeaderboardMode("simple")}
                  >
                    Simple
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 ${leaderboardMode === "detailed" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                    onClick={() => setLeaderboardMode("detailed")}
                  >
                    Detailed
                  </button>
                </div>
              </div>
              {classLeaderboards.length === 0 ? (
                <div className="text-sm text-gray-500">No leaderboard data yet.</div>
              ) : leaderboardMode === "simple" ? (
                <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Rank</th>
                        <th className="px-4 py-3 text-left font-medium">{groupLabel}</th>
                        <th className="px-4 py-3 text-right font-medium">Total Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classLeaderboards.map((group, idx) => (
                        <tr key={group.cls} className="border-t border-slate-100">
                          <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{group.cls}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{group.totals?.all ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {classLeaderboards.map(group => (
                    <div key={group.cls} className="border rounded-xl p-3 bg-white shadow-sm space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate font-semibold text-base text-slate-900" title={group.cls}>{group.cls}</div>
                        <div className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">
                          Total {group.totals?.all ?? 0}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Completion</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{Math.round(group.avgCompletion * 100)}%</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Avg points</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{group.avgTotal.toFixed(1)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Leads</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{group.stationLeads}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {[
                          { key: "M", label: "Boys" },
                          { key: "F", label: "Girls" },
                        ].map(section => (
                          <div key={section.key} className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{section.label}</div>
                              <div className="text-xs font-semibold text-slate-700">{group.totals?.[section.key] ?? 0} pts</div>
                            </div>
                            {(group.buckets?.[section.key] || []).length === 0 ? (
                              <div className="text-sm text-gray-500">No scores yet</div>
                            ) : (
                              group.buckets[section.key].map((it, idx) => (
                                <div key={it.student.id} className="flex items-center justify-between gap-3 text-sm">
                                  <div className="min-w-0 flex flex-1 items-center gap-1.5">
                                    <span className="shrink-0 text-slate-500">{idx + 1}.</span>
                                    <span className="truncate text-slate-900" title={it.student.name || "Unknown"}>{it.student.name || "Unknown"}</span>
                                  </div>
                                  <div className="shrink-0 font-medium tabular-nums text-slate-700">{it.total}</div>
                                </div>
                              ))
                            )}
                          </div>
                        ))}
                        {group.buckets?.U?.length > 0 && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 space-y-2">
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Unspecified</div>
                            {group.buckets.U.map((it, idx) => (
                              <div key={it.student.id} className="flex items-center justify-between gap-3 text-sm">
                                <div className="min-w-0 flex flex-1 items-center gap-1.5">
                                  <span className="shrink-0 text-slate-500">{idx + 1}.</span>
                                  <span className="truncate text-slate-900" title={it.student.name || "Unknown"}>{it.student.name || "Unknown"}</span>
                                </div>
                                <div className="shrink-0 font-medium tabular-nums text-slate-700">{it.total}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Top Scorers</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {pbCards.map(({ station, resByGender }) => (
                  <div key={station.key} className="border rounded-xl p-3 bg-white shadow-sm space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {station.Icon ? <station.Icon className="w-4 h-4" aria-hidden="true" /> : null}
                      <span className="font-medium text-slate-700">{station.label}</span>
                    </div>
                    <div className="space-y-2">
                      {["M","F"].map((g) => {
                        const label = g === "M" ? "Boys" : "Girls";
                        const res = resByGender[g];
                        const winnerGroup = groupBy === "house"
                          ? (res?.best?.student?.house || "-")
                          : (res?.best?.student?.class || "-");
                        const runnerGroup = groupBy === "house"
                          ? (res?.next?.student?.house || "-")
                          : (res?.next?.student?.class || "-");
                        return (
                          <div key={g} className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
                              {res ? <div className="text-3xl font-bold leading-none tabular-nums text-slate-900">{formatValue(station.key, res.best.value)}</div> : null}
                            </div>
                            {res ? (
                              <div className="mt-1 space-y-1">
                                <div
                                  className="truncate text-sm font-medium leading-tight text-slate-900"
                                  title={res.best.student?.name || "-"}
                                >
                                  {res.best.student?.name || "-"}
                                </div>
                                <div className="text-[11px] text-slate-500">{groupLabel}: {winnerGroup}</div>
                                <div
                                  className="truncate text-[15px] text-slate-600"
                                  title={res.next ? `Next: ${res.next.student?.name || "-"} · ${runnerGroup} · ${formatValue(station.key, res.next.value)}` : "Next: -"}
                                >
                                  Next: {res.next ? `${res.next.student?.name || "-"} · ${runnerGroup} · ${formatValue(station.key, res.next.value)}` : "-"}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-1 text-sm text-gray-500">No scores yet</div>
                            )}
                          </div>
                        );
                      })}
                      {resByGender.U?.best && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Unspecified</div>
                            <div className="text-3xl font-bold leading-none tabular-nums text-slate-900">{formatValue(station.key, resByGender.U.best.value)}</div>
                          </div>
                          <div className="mt-1 space-y-1">
                            <div
                              className="truncate text-sm font-medium leading-tight text-slate-900"
                              title={resByGender.U.best.student?.name || "-"}
                            >
                              {resByGender.U.best.student?.name || "-"}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {groupLabel}: {groupBy === "house" ? (resByGender.U.best.student?.house || "-") : (resByGender.U.best.student?.class || "-")}
                            </div>
                            <div
                              className="truncate text-[15px] text-slate-600"
                              title={resByGender.U.next ? `Next: ${resByGender.U.next.student?.name || "-"} · ${groupBy === "house" ? (resByGender.U.next.student?.house || "-") : (resByGender.U.next.student?.class || "-")} · ${formatValue(station.key, resByGender.U.next.value)}` : "Next: -"}
                            >
                              Next: {resByGender.U.next ? `${resByGender.U.next.student?.name || "-"} · ${groupBy === "house" ? (resByGender.U.next.student?.house || "-") : (resByGender.U.next.student?.class || "-")} · ${formatValue(station.key, resByGender.U.next.value)}` : "-"}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Badge Showcase</h2>
              {badgeShowcase.length === 0 ? (
                <div className="text-sm text-gray-500">No badge data yet.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {badgeShowcase.map((badge) => (
                    <div key={badge.key} className="border rounded-xl p-3 bg-white shadow-sm space-y-3">
                      <div className="flex items-center gap-3">
                        {badge.imageSrc ? (
                          <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1">
                            <img src={badge.imageSrc} alt="" className="h-11 w-11 object-contain" aria-hidden="true" />
                          </div>
                        ) : null}
                        <div className="min-w-0">
                          <div className="font-semibold text-base text-slate-900">{badge.name}</div>
                          <div className="text-xs text-slate-500">{badge.desc}</div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 space-y-2">
                        {badge.qualifiers.length === 0 ? (
                          <div className="text-sm text-slate-500">No {groupLabel.toLowerCase()} has unlocked this badge yet.</div>
                        ) : (
                          badge.qualifiers.map((item) => (
                            <div key={item.group} className="flex items-center justify-between gap-3 text-sm">
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-slate-900" title={item.group}>{item.group}</div>
                                <div className="text-[11px] text-slate-500">{item.detail}</div>
                              </div>
                              <div className="shrink-0 text-xs font-semibold text-slate-800">{item.metric}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </>
        )}
      </div>
    </main>
  );
}
