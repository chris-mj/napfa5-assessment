import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { startLoaderMetric } from "../lib/devLoaderMetrics";
import { normalizeStudentId } from "../utils/ids";

export default function SessionRosterSelect({ sessionId, schoolId, onDone }) {
  const [year, setYear] = useState("");
  const [klass, setKlass] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState("");

  const canApply = useMemo(() => selected.size > 0, [selected]);

  const load = useCallback(async () => {
    const doneMetric = startLoaderMetric("SessionRosterSelect.load", {
      school_id: schoolId,
    });
    setLoading(true);
    setMessage("");
    const query = supabase
      .from("enrollments")
      .select("class, academic_year, students!inner(id, student_identifier, name)")
      .eq("school_id", schoolId)
      .eq("is_active", true);
    if (year) query.eq("academic_year", Number(year));
    if (klass) query.ilike("class", `%${klass}%`);

    const { data, error } = await query.order("class", { ascending: true });
    if (error) {
      doneMetric({ failed: true, error });
      setMessage(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const nextRows = (data || []).map((row) => ({
      student_id: row.students.id,
      student_identifier: row.students.student_identifier,
      name: row.students.name,
      class: row.class,
      academic_year: row.academic_year,
    }));
    setRows(nextRows);
    doneMetric({ rows: nextRows.length });
    setLoading(false);
  }, [klass, schoolId, year]);

  useEffect(() => {
    if (schoolId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const toggle = (studentId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const addSelected = async () => {
    setMessage("");
    const rosterRows = Array.from(selected).map((studentId) => ({ session_id: sessionId, student_id: studentId }));
    if (!rosterRows.length) return;

    const { error } = await supabase
      .from("session_roster")
      .upsert(rosterRows, { onConflict: "session_id,student_id" });
    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`Added ${rosterRows.length} students to roster.`);
    setSelected(new Set());
    onDone?.();
  };

  return (
    <div className="border rounded p-4 space-y-3">
      <h3 className="font-semibold">Select Active Enrollments</h3>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm mb-1">Academic Year</label>
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2025" className="border rounded p-2 w-32" />
        </div>
        <div>
          <label className="block text-sm mb-1">Class</label>
          <input value={klass} onChange={(e) => setKlass(e.target.value)} placeholder="e.g. 3A" className="border rounded p-2 w-32" />
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-2 border rounded hover:bg-gray-100 disabled:opacity-60">{loading ? "Loading..." : "Load"}</button>
        <button onClick={addSelected} disabled={!canApply} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">Add Selected to Session</button>
      </div>
      {message && <div className="text-sm">{message}</div>}
      <div className="max-h-72 overflow-auto border rounded">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 border w-10"></th>
              <th className="px-3 py-2 border">Student ID</th>
              <th className="px-3 py-2 border">Name</th>
              <th className="px-3 py-2 border">Class</th>
              <th className="px-3 py-2 border">Year</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="5" className="px-3 py-4 text-center text-gray-500">No active enrollments match.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.student_id}>
                <td className="px-3 py-2 border">
                  <input type="checkbox" checked={selected.has(row.student_id)} onChange={() => toggle(row.student_id)} />
                </td>
                <td className="px-3 py-2 border">{normalizeStudentId(row.student_identifier)}</td>
                <td className="px-3 py-2 border">{row.name}</td>
                <td className="px-3 py-2 border">{row.class}</td>
                <td className="px-3 py-2 border">{row.academic_year}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

