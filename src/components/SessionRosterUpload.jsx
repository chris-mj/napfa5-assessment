import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { parseNapfaCsv } from "../utils/napfaCsv";

export default function SessionRosterUpload({ sessionId, schoolId, onDone }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const disabled = useMemo(() => !file || parsing || submitting, [file, parsing, submitting]);

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setErrors([]);
    setParsed(null);
    setMessage("");
    try {
      const text = await file.text();
      const out = parseNapfaCsv(text, { academicYear: year, schoolId });
      setParsed(out);
      setErrors(out.errors || []);
    } catch (e) {
      setErrors([{ row: 0, message: e.message }]);
    } finally {
      setParsing(false);
    }
  };

  const upsertStudents = async (students) => {
    if (!students.length) return {};
    const { data, error } = await supabase
      .from("students")
      .upsert(students, { onConflict: "student_identifier" })
      .select("id, student_identifier");
    if (error) throw error;
    const map = new Map(data.map((row) => [row.student_identifier, row.id]));
    return map;
  };

  const upsertEnrollmentsAndRosterAndScores = async (rows, idMap) => {
    // Note: simple per-row operations for clarity; can be batched later
    for (const r of rows) {
      const studentId = idMap.get(r.id);
      if (!studentId) continue;
      // Deactivate any previous active enrollment for this student
      await supabase.from("enrollments").update({ is_active: false }).eq("student_id", studentId).eq("is_active", true);
      // Insert new active enrollment
      await supabase.from("enrollments").insert({
        student_id: studentId,
        school_id: schoolId,
        class: r.class,
        academic_year: r.academic_year,
        is_active: true,
      });
      // Add to session roster (ignore duplicates via unique constraint)
      await supabase.from("session_roster").upsert({ session_id: sessionId, student_id: studentId }, { onConflict: "session_id,student_id" });
      // Upsert score for this session + student
      await supabase
        .from("scores")
        .upsert(
          {
            session_id: sessionId,
            student_id: studentId,
            situps: r.situps ?? null,
            broad_jump: r.broad_jump_cm ?? null,
            sit_and_reach: r.sit_and_reach_cm ?? null,
            pullups: r.pullups ?? null,
            shuttle_run: r.shuttle_run_sec ?? null,
          },
          { onConflict: "session_id,student_id" }
        );
    }
  };

  const handleApply = async () => {
    if (!parsed) return;
    setSubmitting(true);
    setMessage("");
    try {
      const idMap = await upsertStudents(parsed.studentsUpserts);
      await upsertEnrollmentsAndRosterAndScores(parsed.rows, idMap);
      setMessage(`Imported ${parsed.rows.length} rows. Errors: ${parsed.errors.length}`);
      onDone?.();
    } catch (e) {
      setMessage(`Failed to import: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border rounded p-4 space-y-3">
      <h3 className="font-semibold">Upload Roster (CSV)</h3>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div>
          <label className="block text-sm mb-1">Academic Year</label>
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value || "0", 10))} className="border rounded p-2 w-40" />
        </div>
        <div>
          <label className="block text-sm mb-1">CSV File</label>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <div className="flex gap-2">
          <button disabled={!file || parsing} onClick={handleParse} className="px-3 py-2 border rounded hover:bg-gray-100 disabled:opacity-60">
            {parsing ? "Parsing..." : "Parse"}
          </button>
          <button disabled={disabled || !parsed} onClick={handleApply} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">
            {submitting ? "Importing..." : "Apply to Session"}
          </button>
        </div>
      </div>
      {parsed && (
        <div className="text-sm text-gray-700">
          Parsed: {parsed.summary.parsed}, Errors: {errors.length}
        </div>
      )}
      {errors.length > 0 && (
        <div className="text-sm text-red-600">
          {errors.slice(0, 5).map((e, idx) => (
            <div key={idx}>Row {e.row}: {e.message}</div>
          ))}
          {errors.length > 5 && <div>...and {errors.length - 5} more</div>}
        </div>
      )}
      {message && <div className="text-sm">{message}</div>}
    </div>
  );
}

