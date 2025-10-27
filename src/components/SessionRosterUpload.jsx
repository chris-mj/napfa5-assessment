import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { parseNapfaCsv } from "../utils/napfaCsv";
import { useToast } from "./ToastProvider";

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
      // Build diffs preview
      const ids = Array.from(new Set((out.rows||[]).map(r => (r.id||'').toUpperCase()).filter(Boolean)));
      if (!ids.length) { setDiffs([]); }
      else {
        const { data: studs } = await supabase.from('students').select('id, student_identifier').in('student_identifier', ids);
        const idMap = new Map((studs||[]).map(s => [s.student_identifier.toUpperCase(), s.id]));
        const sids = Array.from(idMap.values());
        let enrolls = [];
        if (sids.length) {
          const { data: ens } = await supabase.from('enrollments').select('id, student_id, school_id, class, academic_year, is_active').in('student_id', sids);
          enrolls = ens || [];
        }
        const diffsPreview = (out.rows||[]).map(r => {
          const sid = idMap.get((r.id||'').toUpperCase());
          const tgt = { school_id: schoolId, class: r.class || null, year: r.academic_year };
          if (!sid) return { id: r.id, name: r.name, action: 'create student + enroll', detail: `${tgt.class || '-'} / ${tgt.year}` };
          const eAll = enrolls.filter(e => e.student_id === sid);
          const matchActive = eAll.find(e => e.school_id === tgt.school_id && (e.class||null) === tgt.class && e.academic_year === tgt.year && e.is_active);
          if (matchActive) return { id: r.id, name: r.name, action: 'no change', detail: `${tgt.class || '-'} / ${tgt.year}` };
          const sameYear = eAll.find(e => e.school_id === tgt.school_id && e.academic_year === tgt.year);
          if (sameYear) return { id: r.id, name: r.name, action: `update class ${sameYear.class||'-'} → ${tgt.class||'-'}`, detail: `${tgt.year}` };
          return { id: r.id, name: r.name, action: 'new enrollment', detail: `${tgt.class || '-'} / ${tgt.year}` };
        });
        setDiffs(diffsPreview);
      }
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
    const stats = { created: 0, updated: 0, exists: 0, failed: 0 };
    const details = [];
    for (const r of rows) {
      try {
        const studentId = idMap.get(r.id);
        if (!studentId) { stats.failed++; details.push({ id: r.id, name: r.name, result: 'failed', detail: 'missing student id' }); continue; }

        const targetClass = r.class || null;
        const targetYear = r.academic_year;

        // Fetch enrollments for this student
        const { data: enrolls } = await supabase
          .from('enrollments')
          .select('id, school_id, class, academic_year, is_active')
          .eq('student_id', studentId);

        const matchActive = (enrolls || []).find(e => e.school_id === schoolId && (e.class || null) === targetClass && e.academic_year === targetYear && e.is_active);
        if (matchActive) { stats.exists++; details.push({ id: r.id, name: r.name, result: 'already exists', detail: `${targetClass || '-'} / ${targetYear}` }); }
        else {
          const sameYearRow = (enrolls || []).find(e => e.school_id === schoolId && e.academic_year === targetYear);
          if (sameYearRow) {
            await supabase.from('enrollments').update({ is_active: false }).eq('student_id', studentId).eq('is_active', true).neq('id', sameYearRow.id);
            const { error: uErr } = await supabase.from('enrollments').update({ class: targetClass, is_active: true }).eq('id', sameYearRow.id);
            if (uErr) throw uErr;
            stats.updated++;
            details.push({ id: r.id, name: r.name, result: 'updated', detail: `class ${sameYearRow.class||'-'} → ${targetClass||'-'} @ ${targetYear}` });
          } else {
            await supabase.from('enrollments').update({ is_active: false }).eq('student_id', studentId).eq('is_active', true);
            const { error: iErr } = await supabase.from('enrollments').insert({ student_id: studentId, school_id: schoolId, class: targetClass, academic_year: targetYear, is_active: true });
            if (iErr) throw iErr;
            stats.created++;
            details.push({ id: r.id, name: r.name, result: 'created', detail: `${targetClass || '-'} / ${targetYear}` });
          }
        }

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
      } catch {
        stats.failed++;
        details.push({ id: r.id, name: r.name, result: 'failed', detail: '-' });
      }
    }
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
      showToast('success', msg);
      try {
        const header = 'Student ID,Name,Result,Detail\n';
        const body = (details||[]).map(d => [d.id, d.name||'', d.result, d.detail||''].map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([header+body], { type: 'text/csv' }));
        setSummaryUrl(url);
        setResultStats(stats);
      } catch {}
      onDone?.();
    } catch (e) {
      setMessage(`Failed to import: ${e.message}`);
      showToast('error', `Failed to import: ${e.message}`);
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
                const created = diffs.filter(d => d.action === 'new enrollment' || d.action === 'create student + enroll').length;
                const updated = diffs.filter(d => String(d.action||'').startsWith('update class')).length;
                const exists = diffs.filter(d => d.action === 'no change').length;
                return (
                  <div className="border border-blue-200 bg-blue-50 text-blue-900 rounded p-2 text-sm">
                    Planned: Created {created}, Updated {updated}, Already exists {exists}. Parse errors: {errors.length}.
                  </div>
                );
              })()}
              <div className="border rounded p-2 bg-gray-50 max-h-40 overflow-auto text-xs">
                <div className="font-medium mb-1">Planned changes (first 30):</div>
                {diffs.slice(0,30).map((d,i)=> (
                  <div key={i}>{d.id} - {d.name || '-'}: {d.action} ({d.detail})</div>
                ))}
              </div>
            </>
          )}
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
