import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
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

export default function Gamification({ user }) {
  const [membership, setMembership] = useState(null);
  const [schoolType, setSchoolType] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState(null);
  const [roster, setRoster] = useState([]);
  const [scoresMap, setScoresMap] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [groupBy, setGroupBy] = useState("class");
  const refreshTimerRef = useRef(null);

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

  useEffect(() => {
    let ignore = false;
    const loadSession = async () => {
      if (!sessionId) { setSession(null); setRoster([]); setScoresMap(new Map()); return; }
      setLoading(true);
      try {
        const { data: sess } = await supabase
          .from("sessions")
          .select("*")
          .eq("id", sessionId)
          .maybeSingle();
        if (!ignore) setSession(sess || null);
        const { data: rRows } = await supabase
          .from("session_roster")
          .select("student_id, house, students!inner(id, student_identifier, name, gender, dob, enrollments(class,academic_year))")
          .eq("session_id", sessionId);
        const sessionYear = sess?.session_date ? new Date(sess.session_date).getFullYear() : null;
        const list = (rRows || []).map(r => {
          const s = r.students || {};
          const ens = Array.isArray(s.enrollments) ? s.enrollments : [];
          let cls = "";
          if (sessionYear) {
            const m = ens.find(e => String(e.academic_year) === String(sessionYear));
            cls = m?.class || "";
          }
          if (!cls && ens.length) {
            const sorted = [...ens].sort((a,b)=> (b.academic_year||0)-(a.academic_year||0));
            cls = sorted[0]?.class || "";
          }
          return { id: s.id, name: s.name, gender: s.gender, dob: s.dob, class: cls, house: r.house || "" };
        });
        const isIppt3 = (sess?.assessment_type || "NAPFA5") === "IPPT3";
        const { data: sRows } = await supabase
          .from(isIppt3 ? "ippt3_scores" : "scores")
          .select("*")
          .eq("session_id", sessionId);
        const map = new Map((sRows || []).map(r => [r.student_id, r]));
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
  }, [sessionId]);

  // Realtime updates: listen for score changes, then refetch once after a debounce.
  // This avoids hammering the DB with one fetch per update while keeping the view live.
  useEffect(() => {
    if (!sessionId || !session) return;
    const isIppt3 = (session?.assessment_type || "NAPFA5") === "IPPT3";
    const table = isIppt3 ? "ippt3_scores" : "scores";
    let cancelled = false;
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        refreshTimerRef.current = null;
        try {
          const { data } = await supabase
            .from(table)
            .select("*")
            .eq("session_id", sessionId);
          if (!cancelled) {
            setScoresMap(new Map((data || []).map(r => [r.student_id, r])));
          }
        } catch {}
      }, 5000);
    };
    const channel = supabase
      .channel(`scores:${table}:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `session_id=eq.${sessionId}` },
        () => scheduleRefresh()
      )
      .subscribe();
    return () => {
      cancelled = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [sessionId, session?.assessment_type]);

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

  const classLeaderboards = useMemo(() => {
    const isIppt3 = (session?.assessment_type || "NAPFA5") === "IPPT3";
    const testDate = session?.session_date ? new Date(session.session_date) : new Date();
    const level = String(schoolType || "").toLowerCase() === "primary" ? "Primary" : "Secondary";
    const byClass = new Map();
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
      if (!byClass.has(key)) byClass.set(key, { M: [], F: [], U: [] });
      const genderKey = sex === "Male" ? "M" : sex === "Female" ? "F" : "U";
      byClass.get(key)[genderKey].push({ student: r, total });
    });
    const out = Array.from(byClass.entries()).map(([cls, buckets]) => {
      const sortTop = (list) => [...list].sort((a,b) => (b.total||0) - (a.total||0)).slice(0, 5);
      const sum = (list) => list.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
      return {
        cls,
        buckets: { M: sortTop(buckets.M), F: sortTop(buckets.F), U: sortTop(buckets.U) },
        totals: { M: sum(buckets.M), F: sum(buckets.F), U: sum(buckets.U), all: sum(buckets.M) + sum(buckets.F) + sum(buckets.U) },
      };
    });
    return out;
  }, [roster, scoresMap, session?.assessment_type, session?.session_date, schoolType, groupBy]);

  return (
    <main className="w-full">
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
          </div>
        </section>

        {loading && (
          <div className="text-sm text-gray-600">Loading session data...</div>
        )}

        {!loading && session && (
          <>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Top Scorers</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {pbCards.map(({ station, resByGender }) => (
                  <div key={station.key} className="border rounded p-4 bg-white shadow-sm">
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      {station.Icon ? <station.Icon className="w-4 h-4" aria-hidden="true" /> : null}
                      <span>{station.label}</span>
                    </div>
                    {["M","F"].map((g) => {
                      const label = g === "M" ? "Boys" : "Girls";
                      const res = resByGender[g];
                      const labelKey = groupBy === "house" ? "House" : "Class";
                      return (
                        <div key={g} className="mt-2">
                          <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
                          {res ? (
                            <>
                              <div className="text-lg font-semibold">{formatValue(station.key, res.best.value)}</div>
                              <div className="text-sm font-medium">
                                {res.best.student?.name || "-"} ({groupBy === "house" ? (res.best.student?.house || "-") : (res.best.student?.class || "-")})
                              </div>
                              <div className="text-xs text-gray-600">
                                Next highest: {res.next ? formatValue(station.key, res.next.value) : "-"}
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-500">No scores yet</div>
                          )}
                        </div>
                      );
                    })}
                    {resByGender.U && (
                      <div className="mt-2">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Unspecified</div>
                        <div className="text-sm font-medium">
                          {resByGender.U.best?.student?.name || "-"} ({groupBy === "house" ? (resByGender.U.best?.student?.house || "-") : (resByGender.U.best?.student?.class || "-")})
                        </div>
                        <div className="text-xs text-gray-600">
                          Next highest: {resByGender.U.next ? formatValue(station.key, resByGender.U.next.value) : "-"}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Leaderboards</h2>
              {classLeaderboards.length === 0 ? (
                <div className="text-sm text-gray-500">No leaderboard data yet.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {classLeaderboards.map(group => (
                    <div key={group.cls} className="border rounded p-4 bg-white shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-semibold text-base">{group.cls}</div>
                        <div className="text-sm font-medium text-gray-700">
                          Total: {group.totals?.all ?? 0}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {[
                          { key: "M", label: "Boys" },
                          { key: "F", label: "Girls" },
                        ].map(section => (
                          <div key={section.key} className="space-y-2">
                            <div className="text-sm font-semibold text-gray-700">{section.label}</div>
                            <div className="flex items-center justify-between text-sm font-medium text-gray-700">
                              <div>{section.label} total</div>
                              <div>{group.totals?.[section.key] ?? 0}</div>
                            </div>
                            {(group.buckets?.[section.key] || []).length === 0 ? (
                              <div className="text-sm text-gray-500">No scores yet</div>
                            ) : (
                              group.buckets[section.key].map((it, idx) => (
                                <div key={it.student.id} className="flex items-center justify-between">
                                  <div>{idx + 1}. {it.student.name || "Unknown"}</div>
                                  <div className="text-gray-600">{it.total}</div>
                                </div>
                              ))
                            )}
                          </div>
                        ))}
                        {group.buckets?.U?.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs uppercase tracking-wide text-gray-500">Unspecified</div>
                            {group.buckets.U.map((it, idx) => (
                              <div key={it.student.id} className="flex items-center justify-between">
                                <div>{idx + 1}. {it.student.name || "Unknown"}</div>
                                <div className="text-gray-600">{it.total}</div>
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
          </>
        )}
      </div>
    </main>
  );
}
