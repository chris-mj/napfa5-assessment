import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";

export default function SummaryData({ user }) {
  const owner = isPlatformOwner(user);
  const [schools, setSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState("");
  const [schoolScope, setSchoolScope] = useState("single"); // single | all | primary | secondaryJC
  const [year, setYear] = useState(new Date().getFullYear());
  const [assessmentType, setAssessmentType] = useState("");
  const [station, setStation] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [rows, setRows] = useState([]);
  const [awardRows, setAwardRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [total, setTotal] = useState(0);
  const [lastSnapshot, setLastSnapshot] = useState("");

  useEffect(() => {
    if (!owner) return;
    const loadSchools = async () => {
      const { data, error: err } = await supabase
        .from("schools")
        .select("id,name,type")
        .order("name", { ascending: true });
      if (err) {
        setError(err.message);
        return;
      }
      setSchools(data || []);
      if (!selectedSchool && (data || []).length) {
        setSelectedSchool(data[0].id);
      }
    };
    loadSchools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const schoolMap = useMemo(() => {
    const map = new Map();
    (schools || []).forEach(s => map.set(s.id, s));
    return map;
  }, [schools]);

  const scopedSchoolIds = useMemo(() => {
    if (schoolScope === "all") return null;
    if (schoolScope === "primary") return (schools || []).filter(s => s.type === "primary").map(s => s.id);
    if (schoolScope === "secondaryJC") return (schools || []).filter(s => s.type === "secondaryJC").map(s => s.id);
    return selectedSchool ? [selectedSchool] : [];
  }, [schoolScope, schools, selectedSchool]);

  useEffect(() => {
    if (!owner || !year) return;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const base = supabase
          .from("assessment_agg")
          .select("*", { count: "exact" })
          .eq("academic_year", Number(year));
        let q = base;
        if (schoolScope !== "all") {
          if (!scopedSchoolIds?.length) {
            setRows([]);
            setTotal(0);
            setLoading(false);
            return;
          }
          q = q.in("school_id", scopedSchoolIds);
        }
        if (assessmentType) q = q.eq("assessment_type", assessmentType);
        if (station) q = q.eq("station_code", station);
        if (gender) q = q.eq("gender", gender);
        if (age) q = q.eq("age_years", Number(age));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const { data, error: err, count } = await q
          .order("assessment_type", { ascending: true })
          .order("station_code", { ascending: true })
          .order("gender", { ascending: true })
          .order("age_years", { ascending: true })
          .range(from, to);
        if (err) throw err;
        setRows(data || []);
        setTotal(count || 0);
      } catch (e) {
        setError(e?.message || "Failed to load summary data.");
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [owner, year, assessmentType, station, gender, age, page, pageSize, schoolScope, scopedSchoolIds]);

  useEffect(() => {
    if (!owner || !year) return;
    const loadAwards = async () => {
      try {
        const { data, error: err } = await supabase
          .from("assessment_award_agg")
          .select("*")
          .eq("academic_year", Number(year))
          .order("assessment_type", { ascending: true })
          .order("gender", { ascending: true })
          .order("age_years", { ascending: true });
        let scoped = data || [];
        if (schoolScope !== "all") {
          if (!scopedSchoolIds?.length) {
            setAwardRows([]);
            return;
          }
          scoped = scoped.filter(r => scopedSchoolIds.includes(r.school_id));
        }
        if (err) throw err;
        setAwardRows(scoped);
      } catch (e) {
        setAwardRows([]);
      }
    };
    loadAwards();
  }, [owner, year, schoolScope, scopedSchoolIds]);

  useEffect(() => {
    if (!owner || !selectedSchool || !year || schoolScope !== "single") {
      setLastSnapshot("");
      return;
    }
    const loadSnapshot = async () => {
      const { data, error: err } = await supabase
        .from("assessment_agg")
        .select("created_at")
        .eq("school_id", selectedSchool)
        .eq("academic_year", Number(year))
        .order("created_at", { ascending: false })
        .limit(1);
      if (err) return setLastSnapshot("");
      setLastSnapshot(data?.[0]?.created_at || "");
    };
    loadSnapshot();
  }, [owner, selectedSchool, year, schoolScope]);

  const stationOptions = useMemo(() => (
    [
      "situps",
      "shuttle_run",
      "sit_and_reach",
      "pullups",
      "broad_jump",
      "run_2400",
      "pushups"
    ]
  ), []);

  if (!owner) return <Navigate to="/dashboard" replace />;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Summary Data</h1>
          <p className="text-sm text-gray-600">Aggregated assessment data by year, age, gender, station, and assessment type.</p>
        </header>

        <section className="bg-white border rounded-lg p-3 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-gray-600">Filters</div>
            <select
              className="text-sm border rounded px-2 py-1 bg-white"
              value={schoolScope}
              onChange={e => { setSchoolScope(e.target.value); setPage(1); }}
            >
              <option value="all">All schools</option>
              <option value="primary">Primary schools</option>
              <option value="secondaryJC">Secondary/JC</option>
              <option value="single">Single school</option>
            </select>
            <select
              className="text-sm border rounded px-2 py-1 bg-white"
              value={selectedSchool}
              disabled={schoolScope !== "single"}
              onChange={e => { setSelectedSchool(e.target.value); setPage(1); }}
            >
              {schools.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
            <input
              className="text-sm border rounded px-2 py-1 bg-white w-24"
              type="number"
              value={year}
              onChange={e => { setYear(e.target.value); setPage(1); }}
            />
            <select className="text-sm border rounded px-2 py-1 bg-white" value={assessmentType} onChange={e => { setAssessmentType(e.target.value); setPage(1); }}>
              <option value="">All assessments</option>
              <option value="NAPFA5">NAPFA5</option>
              <option value="IPPT3">IPPT3</option>
            </select>
            <select className="text-sm border rounded px-2 py-1 bg-white" value={station} onChange={e => { setStation(e.target.value); setPage(1); }}>
              <option value="">All stations</option>
              {stationOptions.map(s => (<option key={s} value={s}>{s}</option>))}
            </select>
            <select className="text-sm border rounded px-2 py-1 bg-white" value={gender} onChange={e => { setGender(e.target.value); setPage(1); }}>
              <option value="">All genders</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="U">U</option>
            </select>
            <input
              className="text-sm border rounded px-2 py-1 bg-white w-20"
              placeholder="Age"
              type="number"
              value={age}
              onChange={e => { setAge(e.target.value); setPage(1); }}
            />
            <div className="text-xs text-gray-500">
              {lastSnapshot ? `Last snapshot: ${new Date(lastSnapshot).toLocaleString()}` : "No snapshot yet"}
            </div>
          </div>
        </section>

        {error && (<div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{error}</div>)}

        <section className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-left">
                {schoolScope !== "single" && (<th className="px-3 py-2 border">School</th>)}
                <th className="px-3 py-2 border">Assessment</th>
                <th className="px-3 py-2 border">Station</th>
                <th className="px-3 py-2 border">Gender</th>
                <th className="px-3 py-2 border">Age</th>
                <th className="px-3 py-2 border">N</th>
                <th className="px-3 py-2 border">Avg</th>
                <th className="px-3 py-2 border">Min</th>
                <th className="px-3 py-2 border">P25</th>
                <th className="px-3 py-2 border">P50</th>
                <th className="px-3 py-2 border">P75</th>
                <th className="px-3 py-2 border">Max</th>
                <th className="px-3 py-2 border">Std</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={schoolScope !== "single" ? 13 : 12} className="px-3 py-6 text-center text-gray-500">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={schoolScope !== "single" ? 13 : 12} className="px-3 py-6 text-center text-gray-500">No summary data</td></tr>
              ) : (
                rows.map(r => (
                  <tr key={r.id}>
                    {schoolScope !== "single" && (
                      <td className="px-3 py-2 border">{schoolMap.get(r.school_id)?.name || r.school_id}</td>
                    )}
                    <td className="px-3 py-2 border">{r.assessment_type}</td>
                    <td className="px-3 py-2 border">{r.station_code}</td>
                    <td className="px-3 py-2 border">{r.gender}</td>
                    <td className="px-3 py-2 border">{r.age_years}</td>
                    <td className="px-3 py-2 border">{r.n}</td>
                    <td className="px-3 py-2 border">{r.avg != null ? Number(r.avg).toFixed(2) : "-"}</td>
                    <td className="px-3 py-2 border">{r.min != null ? Number(r.min).toFixed(2) : "-"}</td>
                    <td className="px-3 py-2 border">{r.p25 != null ? Number(r.p25).toFixed(2) : "-"}</td>
                    <td className="px-3 py-2 border">{r.p50 != null ? Number(r.p50).toFixed(2) : "-"}</td>
                    <td className="px-3 py-2 border">{r.p75 != null ? Number(r.p75).toFixed(2) : "-"}</td>
                    <td className="px-3 py-2 border">{r.max != null ? Number(r.max).toFixed(2) : "-"}</td>
                    <td className="px-3 py-2 border">{r.stddev != null ? Number(r.stddev).toFixed(2) : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-sm">
            <div>Showing {(total ? (page-1)*pageSize + 1 : 0)}-{Math.min(page*pageSize, total)} of {total}</div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button>
            </div>
          </div>
        </section>

        <section className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium">Completion Counts (NAPFA5)</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-left">
                {schoolScope !== "single" && (<th className="px-3 py-2 border">School</th>)}
                <th className="px-3 py-2 border">Assessment</th>
                <th className="px-3 py-2 border">Gender</th>
                <th className="px-3 py-2 border">Age</th>
                <th className="px-3 py-2 border">Completed 5</th>
                <th className="px-3 py-2 border">Completed 6</th>
                <th className="px-3 py-2 border">Total</th>
              </tr>
            </thead>
            <tbody>
              {awardRows.length === 0 ? (
                <tr><td colSpan={schoolScope !== "single" ? 7 : 6} className="px-3 py-6 text-center text-gray-500">No completion data</td></tr>
              ) : (
                awardRows.map(r => (
                  <tr key={r.id}>
                    {schoolScope !== "single" && (
                      <td className="px-3 py-2 border">{schoolMap.get(r.school_id)?.name || r.school_id}</td>
                    )}
                    <td className="px-3 py-2 border">{r.assessment_type}</td>
                    <td className="px-3 py-2 border">{r.gender}</td>
                    <td className="px-3 py-2 border">{r.age_years}</td>
                    <td className="px-3 py-2 border">{r.completed_5_count}</td>
                    <td className="px-3 py-2 border">{r.completed_6_count}</td>
                    <td className="px-3 py-2 border">{r.total_count}</td>
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
