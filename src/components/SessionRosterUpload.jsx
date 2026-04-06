import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { startLoaderMetric } from "../lib/devLoaderMetrics";
import { fetchEnrollmentsMap } from "../lib/sessionRoster";
import { parseNapfaCsv } from "../utils/napfaCsv";
import { useToast } from "./ToastProvider";

function normalizeStudentKey(value) {
  return String(value || "").toUpperCase();
}

function chunkArray(values, size = 500) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function normalizeScoreValue(value) {
  return value == null ? null : value;
}

function buildScorePayload(sessionId, studentId, row) {
  return {
    session_id: sessionId,
    student_id: studentId,
    situps: normalizeScoreValue(row.situps),
    broad_jump: normalizeScoreValue(row.broad_jump_cm),
    sit_and_reach: normalizeScoreValue(row.sit_and_reach_cm),
    pullups: normalizeScoreValue(row.pullups),
    shuttle_run: normalizeScoreValue(row.shuttle_run_sec),
  };
}

function scorePayloadChanged(existingRow, nextRow) {
  if (!existingRow) return true;
  return (
    normalizeScoreValue(existingRow.situps) !== nextRow.situps
    || normalizeScoreValue(existingRow.broad_jump) !== nextRow.broad_jump
    || normalizeScoreValue(existingRow.sit_and_reach) !== nextRow.sit_and_reach
    || normalizeScoreValue(existingRow.pullups) !== nextRow.pullups
    || normalizeScoreValue(existingRow.shuttle_run) !== nextRow.shuttle_run
  );
}

export default function SessionRosterUpload({ sessionId, schoolId, onDone }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [diffs, setDiffs] = useState([]);
  const { showToast } = useToast();
  const [summaryUrl, setSummaryUrl] = useState("");
  const [resultStats, setResultStats] = useState(null);

  const disabled = useMemo(() => !file || parsing || submitting, [file, parsing, submitting]);

  const handleParse = async () => {
    const doneMetric = startLoaderMetric("SessionRosterUpload.handleParse");
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
      const ids = Array.from(new Set((out.rows || []).map((row) => normalizeStudentKey(row.id)).filter(Boolean)));
      if (!ids.length) {
        setDiffs([]);
        doneMetric({ rows: 0 });
      } else {
        const { data: students } = await supabase
          .from("students")
          .select("id, student_identifier")
          .in("student_identifier", ids);
        const studentIdByIdentifier = new Map((students || []).map((student) => [
          normalizeStudentKey(student.student_identifier),
          student.id,
        ]));
        const enrollmentsByStudent = await fetchEnrollmentsMap(supabase, Array.from(studentIdByIdentifier.values()));
        const diffsPreview = (out.rows || []).map((row) => {
          const studentId = studentIdByIdentifier.get(normalizeStudentKey(row.id));
          const target = { school_id: schoolId, class: row.class || null, year: row.academic_year };
          if (!studentId) {
            return { id: row.id, name: row.name, action: "create student + enroll", detail: `${target.class || "-"} / ${target.year}` };
          }

          const enrollments = enrollmentsByStudent.get(studentId) || [];
          const matchActive = enrollments.find((enrollment) => (
            enrollment.school_id === target.school_id
            && (enrollment.class || null) === target.class
            && enrollment.academic_year === target.year
            && enrollment.is_active
          ));
          if (matchActive) {
            return { id: row.id, name: row.name, action: "no change", detail: `${target.class || "-"} / ${target.year}` };
          }

          const sameYear = enrollments.find((enrollment) => (
            enrollment.school_id === target.school_id
            && enrollment.academic_year === target.year
          ));
          if (sameYear) {
            return {
              id: row.id,
              name: row.name,
              action: `update class ${sameYear.class || "-"} -> ${target.class || "-"}`,
              detail: `${target.year}`,
            };
          }

          return { id: row.id, name: row.name, action: "new enrollment", detail: `${target.class || "-"} / ${target.year}` };
        });
        setDiffs(diffsPreview);
        doneMetric({ rows: diffsPreview.length });
      }
    } catch (e) {
      doneMetric({ failed: true, error: e });
      setErrors([{ row: 0, message: e.message }]);
    } finally {
      setParsing(false);
    }
  };

  const upsertStudents = async (students) => {
    if (!students.length) return new Map();
    const { data, error } = await supabase
      .from("students")
      .upsert(students, { onConflict: "student_identifier" })
      .select("id, student_identifier");
    if (error) throw error;
    return new Map((data || []).map((row) => [normalizeStudentKey(row.student_identifier), row.id]));
  };

  const upsertEnrollmentsAndRosterAndScores = async (rows, idMap) => {
    const doneMetric = startLoaderMetric("SessionRosterUpload.upsertEnrollmentsAndRosterAndScores", {
      rows_requested: (rows || []).length,
    });
    const stats = { created: 0, updated: 0, exists: 0, failed: 0 };
    const details = [];
    const studentIds = Array.from(new Set(
      (rows || [])
        .map((row) => idMap.get(normalizeStudentKey(row.id)))
        .filter(Boolean)
    ));
    const enrollmentsByStudent = await fetchEnrollmentsMap(supabase, studentIds, {
      fields: "id,student_id,school_id,class,academic_year,is_active",
    });
    const successfulRows = [];

    for (const row of rows) {
      try {
        const studentId = idMap.get(normalizeStudentKey(row.id));
        if (!studentId) {
          stats.failed++;
          details.push({ id: row.id, name: row.name, result: "failed", detail: "missing student id" });
          continue;
        }

        const targetClass = row.class || null;
        const targetYear = row.academic_year;
        let enrollments = enrollmentsByStudent.get(studentId) || [];
        const matchActive = enrollments.find((enrollment) => (
          enrollment.school_id === schoolId
          && (enrollment.class || null) === targetClass
          && enrollment.academic_year === targetYear
          && enrollment.is_active
        ));

        let result = "already exists";
        let detail = `${targetClass || "-"} / ${targetYear}`;

        if (!matchActive) {
          const sameYearRow = enrollments.find((enrollment) => (
            enrollment.school_id === schoolId
            && enrollment.academic_year === targetYear
          ));

          if (sameYearRow) {
            const hasOtherActive = enrollments.some((enrollment) => enrollment.is_active && enrollment.id !== sameYearRow.id);
            if (hasOtherActive) {
              const { error: deactivateErr } = await supabase
                .from("enrollments")
                .update({ is_active: false })
                .eq("student_id", studentId)
                .eq("is_active", true)
                .neq("id", sameYearRow.id);
              if (deactivateErr) throw deactivateErr;
            }

            const needsYearRowUpdate = (sameYearRow.class || null) !== targetClass || !sameYearRow.is_active;
            if (needsYearRowUpdate) {
              const { error: updateErr } = await supabase
                .from("enrollments")
                .update({ class: targetClass, is_active: true })
                .eq("id", sameYearRow.id);
              if (updateErr) throw updateErr;
            }

            enrollments = enrollments.map((enrollment) => {
              if (enrollment.id === sameYearRow.id) {
                return { ...enrollment, class: targetClass, is_active: true };
              }
              if (enrollment.is_active) return { ...enrollment, is_active: false };
              return enrollment;
            });
            enrollmentsByStudent.set(studentId, enrollments);
            result = "updated";
            detail = `class ${sameYearRow.class || "-"} -> ${targetClass || "-"} @ ${targetYear}`;
          } else {
            const hasActiveEnrollment = enrollments.some((enrollment) => enrollment.is_active);
            if (hasActiveEnrollment) {
              const { error: deactivateErr } = await supabase
                .from("enrollments")
                .update({ is_active: false })
                .eq("student_id", studentId)
                .eq("is_active", true);
              if (deactivateErr) throw deactivateErr;
            }

            const { data: insertedEnrollment, error: insertErr } = await supabase
              .from("enrollments")
              .insert({
                student_id: studentId,
                school_id: schoolId,
                class: targetClass,
                academic_year: targetYear,
                is_active: true,
              })
              .select("id, student_id, school_id, class, academic_year, is_active")
              .single();
            if (insertErr) throw insertErr;

            enrollments = [
              ...enrollments.map((enrollment) => (
                enrollment.is_active ? { ...enrollment, is_active: false } : enrollment
              )),
              insertedEnrollment,
            ];
            enrollmentsByStudent.set(studentId, enrollments);
            result = "created";
          }
        }

        if (result === "created") stats.created++;
        else if (result === "updated") stats.updated++;
        else stats.exists++;
        const detailEntry = { id: row.id, name: row.name, result, detail };
        details.push(detailEntry);
        successfulRows.push({ row, studentId, detailEntry, result });
      } catch {
        stats.failed++;
        details.push({ id: row.id, name: row.name, result: "failed", detail: "-" });
      }
    }

    const adjustFailed = (item, reason = "-") => {
      if (item.detailEntry.result === "failed") return;
      if (item.result === "created") stats.created--;
      else if (item.result === "updated") stats.updated--;
      else stats.exists--;
      stats.failed++;
      item.detailEntry.result = "failed";
      item.detailEntry.detail = reason;
    };

    const finalStudentIds = Array.from(new Set(successfulRows.map((item) => item.studentId)));
    const successfulByStudent = new Map();
    successfulRows.forEach((item) => {
      successfulByStudent.set(item.studentId, item);
    });

    if (finalStudentIds.length) {
      const { data: existingRosterRows, error: rosterReadErr } = await supabase
        .from("session_roster")
        .select("student_id")
        .eq("session_id", sessionId)
        .in("student_id", finalStudentIds);
      if (rosterReadErr) {
        successfulRows.forEach((item) => adjustFailed(item, `roster preload failed: ${rosterReadErr.message}`));
      } else {
        const existingRosterSet = new Set((existingRosterRows || []).map((row) => row.student_id));
        const rosterRowsToWrite = [];
        successfulByStudent.forEach((item, studentId) => {
          if (!existingRosterSet.has(studentId)) {
            rosterRowsToWrite.push({ session_id: sessionId, student_id: studentId, item });
          }
        });

        for (const chunk of chunkArray(rosterRowsToWrite)) {
          const payload = chunk.map(({ session_id, student_id }) => ({ session_id, student_id }));
          const { error: rosterWriteErr } = await supabase
            .from("session_roster")
            .upsert(payload, { onConflict: "session_id,student_id" });
          if (!rosterWriteErr) continue;

          for (const rosterRow of chunk) {
            const { error } = await supabase
              .from("session_roster")
              .upsert({ session_id: rosterRow.session_id, student_id: rosterRow.student_id }, { onConflict: "session_id,student_id" });
            if (error) adjustFailed(rosterRow.item, `roster write failed: ${error.message}`);
          }
        }
      }
    }

    const scoreEligibleRows = successfulRows.filter((item) => item.detailEntry.result !== "failed");
    const scoreStudentIds = Array.from(new Set(scoreEligibleRows.map((item) => item.studentId)));
    if (scoreStudentIds.length) {
      const { data: existingScores, error: scoresReadErr } = await supabase
        .from("scores")
        .select("student_id,situps,broad_jump,sit_and_reach,pullups,shuttle_run")
        .eq("session_id", sessionId)
        .in("student_id", scoreStudentIds);
      if (scoresReadErr) {
        scoreEligibleRows.forEach((item) => adjustFailed(item, `score preload failed: ${scoresReadErr.message}`));
      } else {
        const existingScoresByStudent = new Map((existingScores || []).map((scoreRow) => [scoreRow.student_id, scoreRow]));
        const scoreRowsByStudent = new Map();
        scoreEligibleRows.forEach((item) => {
          scoreRowsByStudent.set(item.studentId, {
            payload: buildScorePayload(sessionId, item.studentId, item.row),
            item,
          });
        });

        const scoreRowsToWrite = Array.from(scoreRowsByStudent.entries())
          .filter(([studentId, { payload }]) => scorePayloadChanged(existingScoresByStudent.get(studentId), payload))
          .map(([, value]) => value);

        for (const chunk of chunkArray(scoreRowsToWrite)) {
          const payload = chunk.map(({ payload: scorePayload }) => scorePayload);
          const { error: scoreWriteErr } = await supabase
            .from("scores")
            .upsert(payload, { onConflict: "session_id,student_id" });
          if (!scoreWriteErr) continue;

          for (const scoreRow of chunk) {
            const { error } = await supabase
              .from("scores")
              .upsert(scoreRow.payload, { onConflict: "session_id,student_id" });
            if (error) adjustFailed(scoreRow.item, `score write failed: ${error.message}`);
          }
        }
      }
    }

    doneMetric({ rows: details.length, failed: stats.failed > 0 });
    return { stats, details };
  };

  const handleApply = async () => {
    if (!parsed) return;
    setSubmitting(true);
    setMessage("");
    try {
      const idMap = await upsertStudents(parsed.studentsUpserts);
      const { stats, details } = await upsertEnrollmentsAndRosterAndScores(parsed.rows, idMap);
      const msg = `Imported ${parsed.rows.length} rows. Created: ${stats.created}, Updated: ${stats.updated}, Already exists: ${stats.exists}, Failed: ${stats.failed}. Parse errors: ${parsed.errors.length}`;
      setMessage(msg);
      showToast("success", msg);
      try {
        const header = "Student ID,Name,Result,Detail\n";
        const body = (details || []).map((detail) => [detail.id, detail.name || "", detail.result, detail.detail || ""].map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(",")).join("\n");
        const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
        setSummaryUrl(url);
        setResultStats(stats);
      } catch {}
      onDone?.();
    } catch (e) {
      setMessage(`Failed to import: ${e.message}`);
      showToast("error", `Failed to import: ${e.message}`);
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
        <div className="flex gap-2 items-center flex-wrap">
          <button disabled={!file || parsing} onClick={handleParse} className="px-3 py-2 border rounded hover:bg-gray-100 disabled:opacity-60">
            {parsing ? "Parsing..." : "Parse"}
          </button>
          <button disabled={disabled || !parsed} onClick={handleApply} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">
            {submitting ? "Importing..." : "Apply to Session"}
          </button>
          <a href="/pft_template.csv" download className="px-3 py-2 border rounded hover:bg-gray-100">Download CSV template</a>
        </div>
      </div>
      {parsed && (
        <div className="text-sm text-gray-700 space-y-2">
          <div>Parsed: {parsed.summary.parsed}, Errors: {errors.length}</div>
          {!!diffs.length && (
            <>
              {(() => {
                const created = diffs.filter((diff) => diff.action === "new enrollment" || diff.action === "create student + enroll").length;
                const updated = diffs.filter((diff) => String(diff.action || "").startsWith("update class")).length;
                const exists = diffs.filter((diff) => diff.action === "no change").length;
                return (
                  <div className="border border-blue-200 bg-blue-50 text-blue-900 rounded p-2 text-sm">
                    Planned: Created {created}, Updated {updated}, Already exists {exists}. Parse errors: {errors.length}.
                  </div>
                );
              })()}
              <div className="border rounded p-2 bg-gray-50 max-h-40 overflow-auto text-xs">
                <div className="font-medium mb-1">Planned changes (first 30):</div>
                {diffs.slice(0, 30).map((diff, index) => (
                  <div key={index}>{diff.id} - {diff.name || "-"}: {diff.action} ({diff.detail})</div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {errors.length > 0 && (
        <div className="text-sm text-red-600">
          {errors.slice(0, 5).map((error, index) => (
            <div key={index}>Row {error.row}: {error.message}</div>
          ))}
          {errors.length > 5 && <div>...and {errors.length - 5} more</div>}
        </div>
      )}
      {message && (
        <div className="text-sm">
          {message}
          {resultStats && summaryUrl && (
            <a className="ml-2 underline" href={summaryUrl} download={`roster_import_summary_${Date.now()}.csv`}>Download detailed summary</a>
          )}
        </div>
      )}
    </div>
  );
}

