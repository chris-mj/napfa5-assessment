import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "../components/ToastProvider";
import { isPlatformOwner } from "../lib/roles";

export default function Charts({ user }) {
  const { showToast } = useToast();
  const owner = isPlatformOwner(user);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState(0);
  const [students, setStudents] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [schools, setSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState("");
  const [schoolScope, setSchoolScope] = useState("single");
  const [dataMode, setDataMode] = useState("snapshot_school_year");
  const [year, setYear] = useState(new Date().getFullYear());
  const [assessmentType, setAssessmentType] = useState("");
  const [station, setStation] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [className, setClassName] = useState("");
  const [completionScope, setCompletionScope] = useState("");
  const [snapshotSourceKind, setSnapshotSourceKind] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [sessionChoices, setSessionChoices] = useState([]);
  const [rows, setRows] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const [sess, studs, scores] = await Promise.all([
          supabase.from("sessions").select("id", { count: "exact", head: true }),
          supabase.from("students").select("id", { count: "exact", head: true }),
          supabase.from("scores").select("id", { count: "exact", head: true }),
        ]);
        if (!ignore) {
          setSessions(sess?.count || 0);
          setStudents(studs?.count || 0);
          setAttempts(scores?.count || 0);
        }
      } catch (e) {
        if (!ignore) showToast?.("error", e?.message || "Failed to load charts.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    load();
    return () => { ignore = true; };
  }, [showToast]);

  useEffect(() => {
    if (!owner) return;
    const loadSchools = async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("id,name,type")
        .order("name", { ascending: true });
      if (error) {
        setTableError(error.message);
        return;
      }
      setSchools(data || []);
      if (!selectedSchool && (data || []).length) setSelectedSchool(data[0].id);
    };
    loadSchools();
  }, [owner, selectedSchool]);

  const schoolMap = useMemo(() => {
    const map = new Map();
    (schools || []).forEach((s) => map.set(s.id, s));
    return map;
  }, [schools]);

  const scopedSchoolIds = useMemo(() => {
    if (schoolScope === "all") return null;
    if (schoolScope === "primary") return (schools || []).filter((s) => s.type === "primary").map((s) => s.id);
    if (schoolScope === "secondaryJC") return (schools || []).filter((s) => s.type === "secondaryJC").map((s) => s.id);
    return selectedSchool ? [selectedSchool] : [];
  }, [schoolScope, schools, selectedSchool]);

  useEffect(() => {
    if (!owner || !selectedSchool || !year) {
      setSessionChoices([]);
      if (selectedSession) setSelectedSession("");
      return;
    }
    const loadSessions = async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id,title,session_date")
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
  }, [owner, selectedSchool, year, selectedSession]);

  useEffect(() => {
    if (!owner) return;
    const load = async () => {
      setTableLoading(true);
      setTableError("");
      try {
        const tableMap = {
          snapshot_school_year: "analytics_school_year_station_snapshot",
          snapshot_session_station: "analytics_session_station_snapshot",
          snapshot_session_summary: "analytics_session_summary_snapshot",
        };
        const table = tableMap[dataMode] || "analytics_school_year_station_snapshot";
        let q = supabase.from(table).select("*", { count: "exact" });
        if (dataMode === "snapshot_session_station" || dataMode === "snapshot_session_summary") {
          if (!selectedSession) {
            setRows([]);
            setTotal(0);
            setTableLoading(false);
            return;
          }
          q = q.eq("session_id", selectedSession);
        } else {
          q = q.eq("academic_year", Number(year));
        }
        if (schoolScope !== "all") {
          if (!scopedSchoolIds?.length) {
            setRows([]);
            setTotal(0);
            setTableLoading(false);
            return;
          }
          q = q.in("school_id", scopedSchoolIds);
        }
        if (assessmentType) q = q.eq("assessment_type", assessmentType);
        if (station && dataMode !== "snapshot_session_summary") q = q.eq("station_code", station);
        if (gender) q = q.eq("gender", gender);
        if (age) q = q.eq("age_years", Number(age));
        if (className) q = q.eq("class_name", className);
        if (completionScope) q = q.eq("completion_scope", completionScope);
        if (snapshotSourceKind) q = q.eq("source_kind", snapshotSourceKind);
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        let ordered = q.order("assessment_type", { ascending: true });
        if (dataMode !== "snapshot_session_summary") ordered = ordered.order("station_code", { ascending: true });
        ordered = ordered.order("class_name", { ascending: true }).order("gender", { ascending: true }).order("age_years", { ascending: true });
        const { data, error, count } = await ordered.range(from, to);
        if (error) throw error;
        setRows(data || []);
        setTotal(count || 0);
      } catch (e) {
        setTableError(e?.message || "Failed to load analytics.");
        setRows([]);
        setTotal(0);
      } finally {
        setTableLoading(false);
      }
    };
    load();
  }, [owner, dataMode, year, assessmentType, station, gender, age, className, completionScope, snapshotSourceKind, selectedSession, page, pageSize, schoolScope, scopedSchoolIds]);

  const stationOptions = useMemo(() => [
    "situps",
    "shuttle_run",
    "sit_and_reach",
    "pullups",
    "broad_jump",
    "run_2400",
    "pushups",
  ], []);

  const snapshotMode = owner;
  const classOptions = useMemo(() => {
    const set = new Set((rows || []).map((r) => (r.class_name || "")).filter(Boolean).filter((v) => v !== "__UNCLASSIFIED__"));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
  }, [rows]);
  const liveSnapshotRows = useMemo(() => rows.filter((r) => r.source_kind === "live_snapshot"), [rows]);
  const deletePreserveRows = useMemo(() => rows.filter((r) => r.source_kind === "delete_preserve"), [rows]);
  const otherSourceRows = useMemo(() => rows.filter((r) => !["live_snapshot", "delete_preserve"].includes(r.source_kind)), [rows]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatMetric = (value) => value != null ? Number(value).toFixed(2) : "-";

  const renderTable = (tableRows, title, tone = "slate", description = "") => (
    <section className={`table-scroll ${tone === "amber" ? "border-amber-300" : ""}`}>
      <div className={`px-3 py-2 border-b text-sm font-medium ${tone === "amber" ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-gray-50"}`}>
        {title}
        {description ? <span className="ml-2 font-normal text-xs">{description}</span> : null}
      </div>
      <table className="data-table compact-data-table min-w-[900px]">
        <thead>
          <tr className="bg-gray-100 text-left">
            {schoolScope !== "single" && <th className="px-3 py-2 border">School</th>}
            <th className="px-3 py-2 border">Assessment</th>
            <th className="px-3 py-2 border">Class</th>
            <th className="px-3 py-2 border">Scope</th>
            {dataMode !== "snapshot_session_summary" && <th className="px-3 py-2 border">Station</th>}
            <th className="px-3 py-2 border">Gender</th>
            <th className="px-3 py-2 border">Age</th>
            {dataMode === "snapshot_session_summary" ? (
              <>
                <th className="px-3 py-2 border num">Roster</th>
                <th className="px-3 py-2 border num">Attempted</th>
                <th className="px-3 py-2 border num">Completed 5</th>
                <th className="px-3 py-2 border num">Incomplete</th>
                <th className="px-3 py-2 border num">Run Present</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2 border num">Student Count</th>
                <th className="px-3 py-2 border num">Scored</th>
                {dataMode === "snapshot_school_year" && <th className="px-3 py-2 border num">Sessions</th>}
                {dataMode === "snapshot_school_year" && <th className="px-3 py-2 border num">Class Count</th>}
                <th className="px-3 py-2 border num">Avg</th>
                <th className="px-3 py-2 border num">Min</th>
                <th className="px-3 py-2 border num">P25</th>
                <th className="px-3 py-2 border num">P50</th>
                <th className="px-3 py-2 border num">P75</th>
                <th className="px-3 py-2 border num">Max</th>
                <th className="px-3 py-2 border num">Std</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr><td colSpan={schoolScope !== "single" ? 16 : 15} className="px-3 py-6 text-center text-gray-500">No rows in this source</td></tr>
          ) : tableRows.map((r) => (
            <tr key={r.id}>
              {schoolScope !== "single" && <td className="px-3 py-2 border">{schoolMap.get(r.school_id)?.name || r.school_id}</td>}
              <td className="px-3 py-2 border">{r.assessment_type}</td>
              <td className="px-3 py-2 border">{r.class_name === "__UNCLASSIFIED__" ? "Unclassified" : (r.class_name || "-")}</td>
              <td className="px-3 py-2 border">{r.completion_scope || "-"}</td>
              {dataMode !== "snapshot_session_summary" && <td className="px-3 py-2 border">{r.station_code}</td>}
              <td className="px-3 py-2 border">{r.gender}</td>
              <td className="px-3 py-2 border">{r.age_years}</td>
              {dataMode === "snapshot_session_summary" ? (
                <>
                  <td className="px-3 py-2 border">{r.roster_count}</td>
                  <td className="px-3 py-2 border">{r.attempted_any_count}</td>
                  <td className="px-3 py-2 border">{r.completed_5_count}</td>
                  <td className="px-3 py-2 border">{r.incomplete_count}</td>
                  <td className="px-3 py-2 border">{r.run_present_count}</td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 border">{r.student_count}</td>
                  <td className="px-3 py-2 border">{r.scored_count}</td>
                  {dataMode === "snapshot_school_year" && <td className="px-3 py-2 border">{r.session_count}</td>}
                  {dataMode === "snapshot_school_year" && <td className="px-3 py-2 border">{r.class_count}</td>}
                  <td className="px-3 py-2 border">{formatMetric(r.avg_value)}</td>
                  <td className="px-3 py-2 border">{formatMetric(r.min_value)}</td>
                  <td className="px-3 py-2 border">{formatMetric(r.p25_value)}</td>
                  <td className="px-3 py-2 border">{formatMetric(r.p50_value)}</td>
                  <td className="px-3 py-2 border">{formatMetric(r.p75_value)}</td>
                  <td className="px-3 py-2 border">{formatMetric(r.max_value)}</td>
                  <td className="px-3 py-2 border">{formatMetric(r.stddev_value)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto op-page">
        <header className="op-header">
          <h1 className="text-2xl font-semibold">Snapshot Analytics</h1>
          <p className="text-sm text-gray-600">Owner-only historical analytics from snapshot tables.</p>
        </header>
        <section className="grid grid-cols-3 gap-2">
          <div className="compact-stat">
            <div className="text-xs text-gray-500">Sessions</div>
            <div className="stat-value">{loading ? "..." : sessions}</div>
          </div>
          <div className="compact-stat">
            <div className="text-xs text-gray-500">Students</div>
            <div className="stat-value">{loading ? "..." : students}</div>
          </div>
          <div className="compact-stat">
            <div className="text-xs text-gray-500">Attempts</div>
            <div className="stat-value">{loading ? "..." : attempts}</div>
          </div>
        </section>
        {owner && (
          <>
            <section className="op-card space-y-2">
              <div className="compact-filter-bar">
                <div className="text-sm text-gray-600">Snapshot analytics</div>
                <select className="text-sm border rounded px-2 py-1 bg-white" value={dataMode} onChange={(e) => { setDataMode(e.target.value); setPage(1); setClassName(""); setCompletionScope(""); setSnapshotSourceKind(""); }}>
                  <option value="snapshot_school_year">Snapshot: School-year station</option>
                  <option value="snapshot_session_station">Snapshot: Session station</option>
                  <option value="snapshot_session_summary">Snapshot: Session summary</option>
                </select>
                <select className="text-sm border rounded px-2 py-1 bg-white" value={schoolScope} onChange={(e) => { setSchoolScope(e.target.value); setPage(1); }}>
                  <option value="all">All schools</option>
                  <option value="primary">Primary schools</option>
                  <option value="secondaryJC">Secondary/JC</option>
                  <option value="single">Single school</option>
                </select>
                <select className="text-sm border rounded px-2 py-1 bg-white" value={selectedSchool} disabled={schoolScope !== "single"} onChange={(e) => { setSelectedSchool(e.target.value); setPage(1); }}>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="text-sm border rounded px-2 py-1 bg-white w-24" type="number" value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} />
                {(dataMode === "snapshot_session_station" || dataMode === "snapshot_session_summary") && (
                  <select className="text-sm border rounded px-2 py-1 bg-white w-full sm:w-auto sm:min-w-56" value={selectedSession} onChange={(e) => { setSelectedSession(e.target.value); setPage(1); }}>
                    <option value="">Select session</option>
                    {sessionChoices.map((s) => <option key={s.id} value={s.id}>{s.session_date ? new Date(s.session_date).toLocaleDateString() : ""} {s.title}</option>)}
                  </select>
                )}
                <select className="text-sm border rounded px-2 py-1 bg-white" value={assessmentType} onChange={(e) => { setAssessmentType(e.target.value); setPage(1); }}>
                  <option value="">All assessments</option>
                  <option value="NAPFA5">NAPFA5</option>
                  <option value="IPPT3">IPPT3</option>
                </select>
                {dataMode !== "snapshot_session_summary" && (
                  <select className="text-sm border rounded px-2 py-1 bg-white" value={station} onChange={(e) => { setStation(e.target.value); setPage(1); }}>
                    <option value="">All stations</option>
                    {stationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                <select className="text-sm border rounded px-2 py-1 bg-white" value={gender} onChange={(e) => { setGender(e.target.value); setPage(1); }}>
                  <option value="">All genders</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                  <option value="U">U</option>
                </select>
                <select className="text-sm border rounded px-2 py-1 bg-white" value={className} onChange={(e) => { setClassName(e.target.value); setPage(1); }}>
                  <option value="">All classes</option>
                  {classOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  <option value="__UNCLASSIFIED__">Unclassified</option>
                </select>
                <input className="text-sm border rounded px-2 py-1 bg-white w-20" placeholder="Age" type="number" value={age} onChange={(e) => { setAge(e.target.value); setPage(1); }} />
                {snapshotMode && (
                  <>
                    <select className="text-sm border rounded px-2 py-1 bg-white" value={completionScope} onChange={(e) => { setCompletionScope(e.target.value); setPage(1); }}>
                      <option value="">All completion scopes</option>
                      <option value="completed_only">Completed only</option>
                      <option value="include_incomplete">Include incomplete</option>
                    </select>
                    <select className="text-sm border rounded px-2 py-1 bg-white" value={snapshotSourceKind} onChange={(e) => { setSnapshotSourceKind(e.target.value); setPage(1); }}>
                      <option value="">All sources</option>
                      <option value="live_snapshot">Live snapshot</option>
                      <option value="delete_preserve">Delete preserve</option>
                    </select>
                  </>
                )}
                <div className="text-xs text-gray-500">
                  Snapshot mode shows owner-only analytics tables.
                </div>
              </div>
            </section>

            {tableError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{tableError}</div>}
            {tableLoading ? (
              <section className="bg-white border rounded-lg shadow-sm">
                <div className="px-3 py-6 text-center text-gray-500 text-sm">Loading...</div>
              </section>
            ) : rows.length === 0 ? (
              <section className="bg-white border rounded-lg shadow-sm">
                <div className="px-3 py-6 text-center text-gray-500 text-sm">No analytics data</div>
              </section>
            ) : (
              <>
                <section className="grid grid-cols-3 gap-2">
                  <div className="compact-stat">
                    <div className="text-xs text-gray-500">Total Rows</div>
                    <div className="stat-value">{total}</div>
                  </div>
                  <div className="compact-stat">
                    <div className="text-xs text-gray-500">Live Snapshot Rows</div>
                    <div className="stat-value">{liveSnapshotRows.length}</div>
                  </div>
                  <div className="compact-stat bg-amber-50 border-amber-300">
                    <div className="text-xs text-amber-700">Preserved Deleted Rows</div>
                    <div className="stat-value text-amber-900">{deletePreserveRows.length}</div>
                  </div>
                </section>

                {deletePreserveRows.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    Preserved deleted data is present in this result set. These rows were written before operational student data was deleted.
                  </div>
                )}

                {deletePreserveRows.length > 0 && renderTable(deletePreserveRows, "Preserved Deleted Data", "amber", "Written as delete_preserve before live records were removed")}
                {liveSnapshotRows.length > 0 && renderTable(liveSnapshotRows, "Live Snapshot Data", "slate", "Written from live data snapshot runs")}
                {otherSourceRows.length > 0 && renderTable(otherSourceRows, "Other Snapshot Sources", "slate")}

                <section className="bg-white border rounded-lg shadow-sm">
                  <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-sm">
                    <div>Showing {(total ? (page - 1) * pageSize + 1 : 0)}-{Math.min(page * pageSize, total)} of {total}</div>
                    <div className="flex items-center gap-2">
                      <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                      <span>Page {page} of {totalPages}</span>
                      <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
