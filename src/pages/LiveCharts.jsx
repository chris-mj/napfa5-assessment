import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";
import { useToast } from "../components/ToastProvider";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function summarize(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!nums.length) {
    return { n: 0, avg: null, min: null, p25: null, p50: null, p75: null, max: null, stddev: null };
  }
  const n = nums.length;
  const avg = nums.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? nums.reduce((acc, v) => acc + (v - avg) ** 2, 0) / (n - 1) : 0;
  return {
    n,
    avg,
    min: nums[0],
    p25: percentile(nums, 0.25),
    p50: percentile(nums, 0.5),
    p75: percentile(nums, 0.75),
    max: nums[nums.length - 1],
    stddev: n > 1 ? Math.sqrt(variance) : 0,
  };
}

export default function LiveCharts({ user }) {
  const owner = isPlatformOwner(user);
  const { showToast } = useToast();
  const [schools, setSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [assessmentType, setAssessmentType] = useState("");
  const [station, setStation] = useState("");
  const [gender, setGender] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [completionScope, setCompletionScope] = useState("completed_only");
  const [splitByGender, setSplitByGender] = useState(true);
  const [splitByAge, setSplitByAge] = useState(false);
  const [selectedSession, setSelectedSession] = useState("");
  const [sessionChoices, setSessionChoices] = useState([]);
  const [displayMode, setDisplayMode] = useState("table");
  const [rows, setRows] = useState([]);
  const [awardRows, setAwardRows] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState("");
  const [lastSnapshot, setLastSnapshot] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    const loadSchools = async () => {
      let data = [];
      let error = null;
      if (owner) {
        const res = await supabase.from("schools").select("id,name,type").order("name", { ascending: true });
        data = res.data || [];
        error = res.error || null;
      } else {
        const { data: memberships, error: membershipError } = await supabase
          .from("memberships")
          .select("school_id")
          .eq("user_id", user?.id);
        if (membershipError) {
          error = membershipError;
        } else {
          const ids = Array.from(new Set((memberships || []).map((m) => m.school_id).filter(Boolean)));
          if (ids.length) {
            const res = await supabase.from("schools").select("id,name,type").in("id", ids).order("name", { ascending: true });
            data = res.data || [];
            error = res.error || null;
          } else {
            data = [];
          }
        }
      }
      if (error) {
        setTableError(error.message);
        return;
      }
      setSchools(data);
      if (!selectedSchool && data.length) setSelectedSchool(data[0].id);
    };
    loadSchools();
  }, [owner, selectedSchool, user?.id]);

  const schoolMap = useMemo(() => {
    const map = new Map();
    (schools || []).forEach((s) => map.set(s.id, s));
    return map;
  }, [schools]);

  const scopedSchoolIds = useMemo(() => (selectedSchool ? [selectedSchool] : []), [selectedSchool]);

  const computeAgeYears = (dob, sessionDate) => {
    if (!dob || !sessionDate) return null;
    const d1 = new Date(sessionDate);
    const d2 = new Date(dob);
    return Math.floor((d1 - d2) / (365.25 * 24 * 60 * 60 * 1000));
  };

  useEffect(() => {
    if (!user?.id || !selectedSchool || !year) {
      setSessionChoices([]);
      if (selectedSession) setSelectedSession("");
      return;
    }
    const loadSessions = async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id,title,session_date,assessment_type")
          .eq("school_id", selectedSchool)
          .gte("session_date", `${Number(year)}-01-01`)
          .lte("session_date", `${Number(year)}-12-31`)
          .order("session_date", { ascending: false });
        if (error) throw error;
        setSessionChoices(data || []);
        if (selectedSession && !(data || []).some((s) => s.id === selectedSession)) setSelectedSession("");
      } catch {
        setSessionChoices([]);
      }
    };
    loadSessions();
  }, [user?.id, selectedSchool, year, selectedSession]);

  useEffect(() => {
    if (!user?.id) return;
    const load = async () => {
      setTableLoading(true);
      setTableError("");
      try {
        if (!scopedSchoolIds?.length) {
          setRows([]);
          setTotal(0);
          setTableLoading(false);
          return;
        }

        const sessionRes = await supabase
          .from("sessions")
          .select("id,title,session_date,assessment_type")
          .in("school_id", scopedSchoolIds)
          .gte("session_date", `${Number(year)}-01-01`)
          .lte("session_date", `${Number(year)}-12-31`)
          .order("session_date", { ascending: false });
        if (sessionRes.error) throw sessionRes.error;

        let relevantSessions = sessionRes.data || [];
        if (selectedSession) {
          relevantSessions = relevantSessions.filter((s) => s.id === selectedSession);
        }
        if (assessmentType) {
          relevantSessions = relevantSessions.filter((s) => (s.assessment_type || "NAPFA5") === assessmentType);
        }
        if (!relevantSessions.length) {
          setRows([]);
          setTotal(0);
          setTableLoading(false);
          return;
        }

        const sessionMap = new Map(relevantSessions.map((s) => [s.id, s]));
        const sessionIds = relevantSessions.map((s) => s.id);

        const [rosterRes, scoreRes, ipptRes] = await Promise.all([
          supabase
            .from("session_roster")
            .select("session_id, student_id, students!inner(gender,dob)")
            .in("session_id", sessionIds),
          supabase
            .from("scores")
            .select("session_id, student_id, situps, shuttle_run, sit_and_reach, pullups, broad_jump, run_2400")
            .in("session_id", sessionIds),
          supabase
            .from("ippt3_scores")
            .select("session_id, student_id, situps, pushups, run_2400")
            .in("session_id", sessionIds),
        ]);
        if (rosterRes.error) throw rosterRes.error;
        if (scoreRes.error) throw scoreRes.error;
        if (ipptRes.error && !String(ipptRes.error.message || "").toLowerCase().includes("does not exist")) throw ipptRes.error;

        const rosterByKey = new Map(
          (rosterRes.data || []).map((r) => [`${r.session_id}:${r.student_id}`, r.students]),
        );

        const grouped = new Map();
        const pushValue = (assessment, stationCode, rowGender, rowAge, value) => {
          if (value == null) return;
          if (gender && rowGender !== gender) return;
          if (ageMin !== "" && (rowAge == null || Number(rowAge) < Number(ageMin))) return;
          if (ageMax !== "" && (rowAge == null || Number(rowAge) > Number(ageMax))) return;
          const groupGender = splitByGender ? rowGender : "All";
          const groupAge = splitByAge ? rowAge : null;
          const key = [assessment, stationCode, groupGender, groupAge ?? ""].join("|");
          if (!grouped.has(key)) {
            grouped.set(key, {
              id: key,
              assessment_type: assessment,
              station_code: stationCode,
              gender: groupGender,
              age_years: groupAge,
              values: [],
            });
          }
          grouped.get(key).values.push(Number(value));
        };

        for (const scoreRow of scoreRes.data || []) {
          const session = sessionMap.get(scoreRow.session_id);
          if (!session) continue;
          const assessment = session.assessment_type || "NAPFA5";
          if (assessment === "IPPT3") continue;
          const isCompleted =
            scoreRow.situps != null &&
            scoreRow.shuttle_run != null &&
            scoreRow.sit_and_reach != null &&
            scoreRow.pullups != null &&
            scoreRow.broad_jump != null;
          if (completionScope === "completed_only" && !isCompleted) continue;
          const student = rosterByKey.get(`${scoreRow.session_id}:${scoreRow.student_id}`);
          const rowGender = student?.gender || "U";
          const rowAge = computeAgeYears(student?.dob, session.session_date);
          const stationKeys = ["situps", "shuttle_run", "sit_and_reach", "pullups", "broad_jump", "run_2400"];
          for (const key of stationKeys) {
            if (station && key !== station) continue;
            pushValue(assessment, key, rowGender, rowAge, scoreRow[key]);
          }
        }

        for (const scoreRow of ipptRes.data || []) {
          const session = sessionMap.get(scoreRow.session_id);
          if (!session) continue;
          const assessment = session.assessment_type || "IPPT3";
          if (assessment !== "IPPT3") continue;
          const isCompleted = scoreRow.situps != null && scoreRow.pushups != null && scoreRow.run_2400 != null;
          if (completionScope === "completed_only" && !isCompleted) continue;
          const student = rosterByKey.get(`${scoreRow.session_id}:${scoreRow.student_id}`);
          const rowGender = student?.gender || "U";
          const rowAge = computeAgeYears(student?.dob, session.session_date);
          const stationKeys = ["situps", "pushups", "run_2400"];
          for (const key of stationKeys) {
            if (station && key !== station) continue;
            pushValue(assessment, key, rowGender, rowAge, scoreRow[key]);
          }
        }

        const computedRows = Array.from(grouped.values())
          .map((g) => ({
            id: g.id,
            assessment_type: g.assessment_type,
            station_code: g.station_code,
            gender: g.gender,
            age_years: g.age_years,
            ...summarize(g.values),
          }))
          .sort((a, b) =>
            String(a.assessment_type).localeCompare(String(b.assessment_type)) ||
            String(a.station_code).localeCompare(String(b.station_code)) ||
            String(a.gender).localeCompare(String(b.gender)) ||
            Number(a.age_years ?? -1) - Number(b.age_years ?? -1)
          );

        const from = (page - 1) * pageSize;
        const to = from + pageSize;
        setRows(computedRows.slice(from, to));
        setTotal(computedRows.length);
      } catch (e) {
        setTableError(e?.message || "Failed to load live analytics.");
        setRows([]);
        setTotal(0);
      } finally {
        setTableLoading(false);
      }
    };
    load();
  }, [user?.id, year, assessmentType, station, gender, ageMin, ageMax, completionScope, page, pageSize, scopedSchoolIds, refreshKey, selectedSession, splitByGender, splitByAge]);

  useEffect(() => {
        if (!user?.id) {
      setAwardRows([]);
      return;
    }
    const loadAwards = async () => {
      try {
        if (!scopedSchoolIds?.length) {
          setAwardRows([]);
          return;
        }

        const sessionRes = await supabase
          .from("sessions")
          .select("id,session_date,assessment_type")
          .in("school_id", scopedSchoolIds)
          .gte("session_date", `${Number(year)}-01-01`)
          .lte("session_date", `${Number(year)}-12-31`);
        if (sessionRes.error) throw sessionRes.error;

        let relevantSessions = sessionRes.data || [];
        if (selectedSession) relevantSessions = relevantSessions.filter((s) => s.id === selectedSession);
        if (assessmentType) relevantSessions = relevantSessions.filter((s) => (s.assessment_type || "NAPFA5") === assessmentType);
        if (!relevantSessions.length) {
          setAwardRows([]);
          return;
        }

        const sessionMap = new Map(relevantSessions.map((s) => [s.id, s]));
        const sessionIds = relevantSessions.map((s) => s.id);
        const [rosterRes, scoreRes, ipptRes] = await Promise.all([
          supabase
            .from("session_roster")
            .select("session_id, student_id, students!inner(gender,dob)")
            .in("session_id", sessionIds),
          supabase
            .from("scores")
            .select("session_id, student_id, situps, shuttle_run, sit_and_reach, pullups, broad_jump, run_2400")
            .in("session_id", sessionIds),
          supabase
            .from("ippt3_scores")
            .select("session_id, student_id, situps, pushups, run_2400")
            .in("session_id", sessionIds),
        ]);
        if (rosterRes.error) throw rosterRes.error;
        if (scoreRes.error) throw scoreRes.error;
        if (ipptRes.error && !String(ipptRes.error.message || "").toLowerCase().includes("does not exist")) throw ipptRes.error;

        const rosterByKey = new Map(
          (rosterRes.data || []).map((r) => [`${r.session_id}:${r.student_id}`, r.students]),
        );
        const grouped = new Map();
        const pushCompletion = (assessment, rowGender, rowAge, complete5, complete6) => {
          if (gender && rowGender !== gender) return;
          if (ageMin !== "" && (rowAge == null || Number(rowAge) < Number(ageMin))) return;
          if (ageMax !== "" && (rowAge == null || Number(rowAge) > Number(ageMax))) return;
          const groupGender = splitByGender ? rowGender : "All";
          const groupAge = splitByAge ? rowAge : null;
          const key = [assessment, groupGender, groupAge ?? ""].join("|");
          if (!grouped.has(key)) {
            grouped.set(key, {
              id: key,
              assessment_type: assessment,
              gender: groupGender,
              age_years: groupAge,
              completed_5_count: 0,
              completed_6_count: 0,
              total_count: 0,
            });
          }
          const entry = grouped.get(key);
          entry.total_count += 1;
          if (complete5) entry.completed_5_count += 1;
          if (complete6) entry.completed_6_count += 1;
        };

        for (const scoreRow of scoreRes.data || []) {
          const session = sessionMap.get(scoreRow.session_id);
          if (!session) continue;
          const assessment = session.assessment_type || "NAPFA5";
          if (assessment === "IPPT3") continue;
          const student = rosterByKey.get(`${scoreRow.session_id}:${scoreRow.student_id}`);
          const rowGender = student?.gender || "U";
          const rowAge = computeAgeYears(student?.dob, session.session_date);
          const complete5 =
            scoreRow.situps != null &&
            scoreRow.shuttle_run != null &&
            scoreRow.sit_and_reach != null &&
            scoreRow.pullups != null &&
            scoreRow.broad_jump != null;
          const complete6 = complete5 && scoreRow.run_2400 != null;
          if (completionScope === "completed_only" && !complete5) continue;
          pushCompletion(assessment, rowGender, rowAge, complete5, complete6);
        }

        for (const scoreRow of ipptRes.data || []) {
          const session = sessionMap.get(scoreRow.session_id);
          if (!session) continue;
          const assessment = session.assessment_type || "IPPT3";
          if (assessment !== "IPPT3") continue;
          const student = rosterByKey.get(`${scoreRow.session_id}:${scoreRow.student_id}`);
          const rowGender = student?.gender || "U";
          const rowAge = computeAgeYears(student?.dob, session.session_date);
          const complete3 = scoreRow.situps != null && scoreRow.pushups != null && scoreRow.run_2400 != null;
          if (completionScope === "completed_only" && !complete3) continue;
          pushCompletion(assessment, rowGender, rowAge, complete3, complete3);
        }

        const scopedRows = Array.from(grouped.values()).sort((a, b) =>
          String(a.assessment_type).localeCompare(String(b.assessment_type)) ||
          String(a.gender).localeCompare(String(b.gender)) ||
          Number(a.age_years ?? -1) - Number(b.age_years ?? -1)
        );
        setAwardRows(scopedRows);
      } catch {
        setAwardRows([]);
      }
    };
    loadAwards();
  }, [user?.id, year, scopedSchoolIds, refreshKey, selectedSession, assessmentType, gender, ageMin, ageMax, completionScope, splitByGender, splitByAge]);

  useEffect(() => {
    if (!selectedSchool || !year) {
      setLastSnapshot("");
      return;
    }
    const loadLastSnapshot = async () => {
      const { data, error } = await supabase
        .from("assessment_agg")
        .select("created_at")
        .eq("school_id", selectedSchool)
        .eq("academic_year", Number(year))
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return setLastSnapshot("");
      setLastSnapshot(data?.[0]?.created_at || "");
    };
    loadLastSnapshot();
  }, [selectedSchool, year, refreshKey]);

  const createSummaryData = async () => {
    if (!selectedSchool || !year) return;
    try {
      const hasExisting = !!lastSnapshot;
      const ok = window.confirm(
        hasExisting
          ? `Summary data already exists for ${year}. Recreate it?`
          : `Create summary data for ${year}?`,
      );
      if (!ok) return;
      setSummaryBusy(true);
      const { error } = await supabase.rpc("snapshot_assessment_agg", {
        p_school: selectedSchool,
        p_academic_year: Number(year),
      });
      if (error) throw error;
      const { data, error: reloadError } = await supabase
        .from("assessment_agg")
        .select("created_at")
        .eq("school_id", selectedSchool)
        .eq("academic_year", Number(year))
        .order("created_at", { ascending: false })
        .limit(1);
      if (reloadError) throw reloadError;
      setLastSnapshot(data?.[0]?.created_at || "");
      setRefreshKey((v) => v + 1);
      try {
        showToast?.("success", "Summary data generated.");
      } catch {}
    } catch (e) {
      try {
        showToast?.("error", e?.message || "Failed to create summary data.");
      } catch {}
    } finally {
      setSummaryBusy(false);
    }
  };

  const stationOptions = useMemo(
    () => ["situps", "shuttle_run", "sit_and_reach", "pullups", "broad_jump", "run_2400", "pushups"],
    [],
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatMetric = (value, stationCode = "") => {
    if (value == null) return "-";
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return stationCode === "shuttle_run" ? num.toFixed(2) : Math.round(num).toString();
  };
  const groupedVisualRows = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const key = `${row.assessment_type}|${row.station_code}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          assessment_type: row.assessment_type,
          station_code: row.station_code,
          rows: [],
        });
      }
      map.get(key).rows.push(row);
    });
    return Array.from(map.values()).map((group) => {
      const mins = group.rows
        .map((r) => r.min)
        .filter((v) => v != null && Number.isFinite(Number(v)))
        .map(Number);
      const maxs = group.rows
        .map((r) => r.max)
        .filter((v) => v != null && Number.isFinite(Number(v)))
        .map(Number);
      let range = { min: 0, max: 1 };
      if (mins.length && maxs.length) {
        const min = Math.min(...mins);
        const max = Math.max(...maxs);
        range = min === max ? { min: min - 1, max: max + 1 } : { min, max };
      }
      const step = (range.max - range.min) / 4;
      const ticks = [0, 1, 2, 3, 4].map((i) => ({
        x: i * 25,
        value: range.min + step * i,
      }));
      return {
        ...group,
        range,
        ticks,
      };
    });
  }, [rows]);
  const toGroupX = (value, range) => {
    if (value == null || !Number.isFinite(Number(value))) return 0;
    return ((Number(value) - range.min) / (range.max - range.min)) * 100;
  };
  const labelAnchor = (x) => {
    if (x <= 8) return "start";
    if (x >= 92) return "end";
    return "middle";
  };

  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto op-page">
        <header className="op-header">
          <h1 className="text-2xl font-semibold">Charts</h1>
        </header>

        <section className="op-card space-y-2">
          <div className="compact-filter-bar">
            <div className="text-sm text-gray-600">Analytics filters</div>
            <select className="text-sm border rounded px-2 py-1 bg-white" value={selectedSchool} onChange={(e) => { setSelectedSchool(e.target.value); setPage(1); }}>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input className="text-sm border rounded px-2 py-1 bg-white w-24" type="number" value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} />
            <select className="text-sm border rounded px-2 py-1 bg-white w-full sm:w-auto sm:min-w-56" value={selectedSession} onChange={(e) => { setSelectedSession(e.target.value); setPage(1); }}>
              <option value="">All sessions in year</option>
              {sessionChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.session_date ? new Date(s.session_date).toLocaleDateString() : ""} {s.title}
                </option>
              ))}
            </select>
            <select className="text-sm border rounded px-2 py-1 bg-white" value={assessmentType} onChange={(e) => { setAssessmentType(e.target.value); setPage(1); }}>
              <option value="">All assessments</option>
              <option value="NAPFA5">NAPFA5</option>
              <option value="IPPT3">IPPT3</option>
            </select>
            <select className="text-sm border rounded px-2 py-1 bg-white" value={station} onChange={(e) => { setStation(e.target.value); setPage(1); }}>
              <option value="">All stations</option>
              {stationOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select className="text-sm border rounded px-2 py-1 bg-white" value={gender} onChange={(e) => { setGender(e.target.value); setPage(1); }}>
              <option value="">All genders</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="U">U</option>
            </select>
            <input className="text-sm border rounded px-2 py-1 bg-white w-24" placeholder="Age min" type="number" value={ageMin} onChange={(e) => { setAgeMin(e.target.value); setPage(1); }} />
            <input className="text-sm border rounded px-2 py-1 bg-white w-24" placeholder="Age max" type="number" value={ageMax} onChange={(e) => { setAgeMax(e.target.value); setPage(1); }} />
            <button onClick={createSummaryData} disabled={summaryBusy || !selectedSchool || !year} className="px-3 py-2 border rounded bg-white hover:bg-gray-50 disabled:opacity-60 text-sm">
              {summaryBusy ? "Generating..." : "Create Summary Data"}
            </button>
            <div className="text-xs text-gray-500 sm:ml-auto">
              {lastSnapshot ? `Last generated: ${new Date(lastSnapshot).toLocaleString()}` : "No summary data generated yet"}
            </div>
          </div>
        </section>

        {tableError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{tableError}</div>}

        <section className="table-scroll">
          <div className="px-2 py-1.5 border-b bg-gray-50 flex flex-wrap items-center gap-2 text-sm">
            <div className="inline-flex rounded border overflow-hidden">
              <button
                type="button"
                className={`px-3 py-1.5 ${displayMode === "table" ? "bg-slate-700 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                onClick={() => setDisplayMode("table")}
              >
                Table
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 border-l ${displayMode === "box" ? "bg-slate-700 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                onClick={() => setDisplayMode("box")}
              >
                Box & whisker
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={completionScope === "completed_only"}
                onChange={(e) => {
                  setCompletionScope(e.target.checked ? "completed_only" : "include_incomplete");
                  setPage(1);
                }}
              />
              Completed full assessment only
            </label>
            <label className="inline-flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={splitByGender} onChange={(e) => { setSplitByGender(e.target.checked); setPage(1); }} />
              Split by gender
            </label>
            <label className="inline-flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={splitByAge} onChange={(e) => { setSplitByAge(e.target.checked); setPage(1); }} />
              Split by age
            </label>
          </div>
          {displayMode === "table" ? (
            <table className="data-table compact-data-table min-w-[860px]">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border">Assessment</th>
                  <th className="px-3 py-2 border">Station</th>
                  {splitByGender && <th className="px-3 py-2 border">Gender</th>}
                  {splitByAge && <th className="px-3 py-2 border">Age</th>}
                  <th className="px-3 py-2 border num">N</th>
                  <th className="px-3 py-2 border num">Avg</th>
                  <th className="px-3 py-2 border num">Min</th>
                  <th className="px-3 py-2 border num">P25</th>
                  <th className="px-3 py-2 border num">P50</th>
                  <th className="px-3 py-2 border num">P75</th>
                  <th className="px-3 py-2 border num">Max</th>
                  <th className="px-3 py-2 border num">Std</th>
                </tr>
              </thead>
              <tbody>
                {tableLoading ? (
                  <tr>
                    <td colSpan={10 + (splitByGender ? 1 : 0) + (splitByAge ? 1 : 0)} className="px-3 py-6 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10 + (splitByGender ? 1 : 0) + (splitByAge ? 1 : 0)} className="px-3 py-6 text-center text-gray-500">
                      No live analytics data
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 border">{r.assessment_type}</td>
                      <td className="px-3 py-2 border">{r.station_code}</td>
                      {splitByGender && <td className="px-3 py-2 border">{r.gender}</td>}
                      {splitByAge && <td className="px-3 py-2 border">{r.age_years ?? "-"}</td>}
                      <td className="px-3 py-2 border num">{r.n}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.avg, r.station_code)}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.min, r.station_code)}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.p25, r.station_code)}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.p50, r.station_code)}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.p75, r.station_code)}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.max, r.station_code)}</td>
                      <td className="px-3 py-2 border num">{formatMetric(r.stddev, r.station_code)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : tableLoading ? (
            <div className="px-3 py-6 text-center text-sm text-gray-500">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-500">No live analytics data</div>
          ) : (
            <div className="space-y-3 p-2">
              {groupedVisualRows.map((group) => (
                <section key={group.key} className="border rounded-lg bg-slate-50/70 border-slate-200">
                  <div className="px-3 py-2 border-b border-slate-200 bg-slate-100/80 rounded-t-lg">
                    <div className="font-medium text-slate-900">{group.station_code}</div>
                    <div className="text-xs text-slate-600 mt-1">{group.assessment_type}</div>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 p-2">
                    {group.rows.map((r) => (
                      <div key={r.id} className="border rounded-lg p-2 bg-white space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                              {splitByGender && <span>Gender: {r.gender}</span>}
                              {splitByAge && <span>Age: {r.age_years ?? "-"}</span>}
                              <span>N: {r.n}</span>
                              <span>Avg: {formatMetric(r.avg, r.station_code)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="w-full overflow-x-auto">
                          <svg viewBox="0 0 100 46" className="h-24 min-w-[360px] w-full">
                            <line x1="0" y1="16" x2="100" y2="16" stroke="#cbd5e1" strokeWidth="0.8" />
                            {group.ticks.map((tick) => (
                              <g key={`${r.id}-tick-${tick.x}`}>
                                <line x1={tick.x} y1="14" x2={tick.x} y2="32" stroke="#cbd5e1" strokeWidth="0.8" />
                                  <text x={tick.x} y="42" textAnchor={tick.x === 0 ? "start" : tick.x === 100 ? "end" : "middle"} fontSize="6" fill="#64748b">
                                  {formatMetric(tick.value, group.station_code)}
                                </text>
                              </g>
                            ))}
                            <line x1={toGroupX(r.min, group.range)} y1="16" x2={toGroupX(r.max, group.range)} y2="16" stroke="#64748b" strokeWidth="1.4" />
                            <line x1={toGroupX(r.min, group.range)} y1="10" x2={toGroupX(r.min, group.range)} y2="22" stroke="#64748b" strokeWidth="1.4" />
                            <line x1={toGroupX(r.max, group.range)} y1="10" x2={toGroupX(r.max, group.range)} y2="22" stroke="#64748b" strokeWidth="1.4" />
                            <rect
                              x={toGroupX(r.p25, group.range)}
                              y="9"
                              width={Math.max(toGroupX(r.p75, group.range) - toGroupX(r.p25, group.range), 1)}
                              height="14"
                              fill="#cbd5e1"
                              stroke="#475569"
                              strokeWidth="1"
                              rx="1"
                            />
                            <line x1={toGroupX(r.p50, group.range)} y1="9" x2={toGroupX(r.p50, group.range)} y2="23" stroke="#0f172a" strokeWidth="1.6" />
                            <circle cx={toGroupX(r.avg, group.range)} cy="16" r="1.7" fill="#ea580c" />
                            <text
                              x={toGroupX(r.min, group.range)}
                              y="7"
                              textAnchor={labelAnchor(toGroupX(r.min, group.range))}
                              fontSize="6"
                              fill="#475569"
                            >
                              {formatMetric(r.min, r.station_code)}
                            </text>
                            <text
                              x={toGroupX(r.p25, group.range)}
                              y="7"
                              textAnchor={labelAnchor(toGroupX(r.p25, group.range))}
                              fontSize="6"
                              fill="#475569"
                            >
                              {formatMetric(r.p25, r.station_code)}
                            </text>
                            <text
                              x={toGroupX(r.p50, group.range)}
                              y="28"
                              textAnchor={labelAnchor(toGroupX(r.p50, group.range))}
                              fontSize="6"
                              fill="#0f172a"
                            >
                              {formatMetric(r.p50, r.station_code)}
                            </text>
                            <text
                              x={toGroupX(r.p75, group.range)}
                              y="7"
                              textAnchor={labelAnchor(toGroupX(r.p75, group.range))}
                              fontSize="6"
                              fill="#475569"
                            >
                              {formatMetric(r.p75, r.station_code)}
                            </text>
                            <text
                              x={toGroupX(r.max, group.range)}
                              y="7"
                              textAnchor={labelAnchor(toGroupX(r.max, group.range))}
                              fontSize="6"
                              fill="#475569"
                            >
                              {formatMetric(r.max, r.station_code)}
                            </text>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 px-2 py-1.5 border-t bg-gray-50 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              Showing {total ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, total)} of {total}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="table-scroll">
          <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium">Completion Counts</div>
          <table className="data-table compact-data-table min-w-[560px]">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2 border">Assessment</th>
                {splitByGender && <th className="px-3 py-2 border">Gender</th>}
                {splitByAge && <th className="px-3 py-2 border">Age</th>}
                <th className="px-3 py-2 border num">Completed 5</th>
                <th className="px-3 py-2 border num">Completed 6</th>
                <th className="px-3 py-2 border num">Total</th>
              </tr>
            </thead>
            <tbody>
              {awardRows.length === 0 ? (
                <tr>
                  <td colSpan={4 + (splitByGender ? 1 : 0) + (splitByAge ? 1 : 0)} className="px-3 py-6 text-center text-gray-500">
                    No completion data
                  </td>
                </tr>
              ) : (
                awardRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 border">{r.assessment_type}</td>
                    {splitByGender && <td className="px-3 py-2 border">{r.gender}</td>}
                    {splitByAge && <td className="px-3 py-2 border">{r.age_years ?? "-"}</td>}
                    <td className="px-3 py-2 border num">{r.completed_5_count}</td>
                    <td className="px-3 py-2 border num">{r.completed_6_count}</td>
                    <td className="px-3 py-2 border num">{r.total_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
