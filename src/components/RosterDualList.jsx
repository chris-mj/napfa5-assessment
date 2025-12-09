import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { normalizeStudentId } from "../utils/ids";

export default function RosterDualList({ user, session, membership, canManage, onProfileCards }) {
  const sessionId = session?.id;
  const schoolId = membership?.school_id;
  const sessionYear = useMemo(() => {
    try {
      return session?.session_date ? new Date(session.session_date).getFullYear() : new Date().getFullYear();
    } catch {
      return new Date().getFullYear();
    }
  }, [session?.session_date]);

  const [eligible, setEligible] = useState([]); // left side (not in roster)
  const [roster, setRoster] = useState([]);     // right side (in roster)
  const [scoredSet, setScoredSet] = useState(new Set());

  const [leftSelected, setLeftSelected] = useState(new Set());
  const [rightSelected, setRightSelected] = useState(new Set());

  const [leftFilter, setLeftFilter] = useState({ id: "", name: "", klass: "" });
  const [rightFilter, setRightFilter] = useState({ id: "", name: "", klass: "" });

  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [leftPage, setLeftPage] = useState(1);
  const [rightPage, setRightPage] = useState(1);
  const [leftSelectMode, setLeftSelectMode] = useState('page');
  const [rightSelectMode, setRightSelectMode] = useState('page');

  const [tipOpen, setTipOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const updateRows = () => setRowsPerPage(window.matchMedia('(max-width: 640px)').matches ? 40 : 100);
    updateRows();
    window.addEventListener('resize', updateRows);
    return () => window.removeEventListener('resize', updateRows);
  }, []);

  const loadData = async () => {
    if (!sessionId || !schoolId) return;
    setLoading(true);
    setMessage("");
    try {
      // Load roster
      const { data: rosterRows, error: rErr } = await supabase
        .from('session_roster')
        .select('student_id, students!inner(id, student_identifier, name, enrollments!left(class, academic_year, is_active, school_id))')
        .eq('session_id', sessionId);
      if (rErr) throw rErr;
      let rosterList = (rosterRows || []).map(r => {
        const enr = r.students?.enrollments || [];
        const cls = (Array.isArray(enr) ? enr : [enr]).find(e => e && e.school_id === schoolId && e.academic_year === sessionYear && e.is_active)?.class || '';
        return { id: r.students.id, student_identifier: r.students.student_identifier, name: r.students.name, class: cls };
      });
      // Load scores to determine which cannot be removed
      const { data: scoreRows } = await supabase
        .from('scores')
        .select('student_id, situps, shuttle_run, sit_and_reach, pullups, run_2400, broad_jump')
        .eq('session_id', sessionId);
      // Consider any of the 6 stations (including run) as having scores for lock purposes
      const anyMetrics = ['situps','shuttle_run','sit_and_reach','pullups','broad_jump','run_2400'];
      const byStudent = new Map((scoreRows || []).map(r => [r.student_id, r]));
      const scored = new Set();
      (rosterList || []).forEach(s => {
        const row = byStudent.get(s.id);
        if (!row) return;
        const hasAny = anyMetrics.some(k => row[k] != null);
        if (hasAny) scored.add(s.id);
      });

      // Load eligible enrollments for session year, minus already in roster
      const { data: eligRows, error: eErr } = await supabase
        .from('enrollments')
        .select('student_id, class, academic_year, students!inner(id, student_identifier, name)')
        .eq('school_id', schoolId)
        .eq('academic_year', sessionYear)
        .eq('is_active', true)
        .order('class', { ascending: true });
      if (eErr) throw eErr;
      const rosterIds = new Set((rosterList || []).map(s => s.id));
      let eligibleList = (eligRows || [])
        .filter(r => !rosterIds.has(r.students.id))
        .map(r => ({ id: r.students.id, student_identifier: r.students.student_identifier, name: r.students.name, class: r.class }));

      const byClassName = (a, b) => String(a.class || '').localeCompare(String(b.class || '')) || String(a.name||'').localeCompare(String(b.name||'')) || String(a.student_identifier||'').localeCompare(String(b.student_identifier||''));
      rosterList = rosterList.sort(byClassName);
      eligibleList = eligibleList.sort(byClassName);

      setRoster(rosterList);
      setEligible(eligibleList);
      setScoredSet(scored);
      setLeftSelected(new Set());
      setRightSelected(new Set());
      setLeftPage(1);
      setRightPage(1);
    } catch (e) {
      setMessage(e.message || 'Failed to load roster.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId, schoolId, sessionYear]);

  const leftFiltered = useMemo(() => applyFilters(eligible, leftFilter), [eligible, leftFilter]);
  const rightFiltered = useMemo(() => applyFilters(roster, rightFilter), [roster, rightFilter]);

  const leftPaged = useMemo(() => paginate(leftFiltered, leftPage, rowsPerPage), [leftFiltered, leftPage, rowsPerPage]);
  const rightPaged = useMemo(() => paginate(rightFiltered, rightPage, rowsPerPage), [rightFiltered, rightPage, rowsPerPage]);

  const leftSummary = useMemo(() => summarizeByClass(leftFiltered), [leftFiltered]);
  const rightSummary = useMemo(() => summarizeByClass(rightFiltered), [rightFiltered]);

  const toggleLeft = (id) => setLeftSelected(prev => toggleSet(prev, id));
  const toggleRight = (id) => setRightSelected(prev => toggleSet(prev, id));
  const headerToggleLeft = (checked) => {
    const scope = leftSelectMode === 'filter' ? leftFiltered : leftPaged.rows;
    setLeftSelected(prev => {
      const next = new Set(prev);
      if (checked) scope.forEach(s => next.add(s.id)); else scope.forEach(s => next.delete(s.id));
      return next;
    });
  };
  const headerToggleRight = (checked) => {
    const base = rightSelectMode === 'filter' ? rightFiltered : rightPaged.rows;
    const scope = base.filter(s => !scoredSet.has(s.id));
    setRightSelected(prev => {
      const next = new Set(prev);
      if (checked) scope.forEach(s => next.add(s.id)); else scope.forEach(s => next.delete(s.id));
      return next;
    });
  };

  const moveRight = async () => {
    if (!canManage) return;
    const ids = Array.from(leftSelected);
    if (!ids.length) return;
    setLoading(true);
    setMessage("");
    try {
      const upserts = ids.map(sid => ({ session_id: sessionId, student_id: sid }));
      const { error: rErr } = await supabase.from('session_roster').upsert(upserts, { onConflict: 'session_id,student_id' });
      if (rErr) throw rErr;
      // Do not pre-create empty score rows; scores are inserted only when first recorded.
      setMessage(`Added ${ids.length} student(s) to session.`);
      await loadData();
    } catch (e) {
      setMessage(e.message || 'Failed to add to roster.');
    } finally {
      setLoading(false);
    }
  };

  const moveLeft = async () => {
    if (!canManage) return;
    const ids = Array.from(rightSelected).filter(id => !scoredSet.has(id));
    if (!ids.length) return;
    setLoading(true);
    setMessage("");
    try {
      for (const sid of ids) {
        const { error } = await supabase.from('session_roster').delete().match({ session_id: sessionId, student_id: sid });
        if (error) throw error;
      }
      setMessage(`Removed ${ids.length} student(s) from session.`);
      await loadData();
    } catch (e) {
      setMessage(e.message || 'Failed to remove from roster.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      {tipOpen && (
        <div className="px-3 py-2 border rounded bg-yellow-50 text-yellow-900 text-sm flex items-start gap-3">
          <div className="font-medium">Tip</div>
          <div className="flex-1">
            Ensure each student has an enrollment for <b>{sessionYear}</b>. Students with recorded scores in this session cannot be removed.
          </div>
          <button onClick={() => setTipOpen(false)} className="text-xs underline">Hide</button>
        </div>
      )}

      {/* Top controls */}
      <div className="flex items-center justify-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={moveRight} disabled={!canManage || leftSelected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Move Right &gt;&gt;</button>
          <button onClick={moveLeft} disabled={!canManage || rightSelected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">
          &lt;&lt; Move Left
        </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Eligible enrollments */}
        <div className="border rounded-lg bg-white flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium">Students Enrolled — {sessionYear}</div>
          <TableFilters filter={leftFilter} setFilter={setLeftFilter} disabled={loading} />
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border w-8">
                    <SelectAllHeader
                      mode={leftSelectMode}
                      setMode={setLeftSelectMode}
                      checked={allSelectedForScope(leftSelected, leftFiltered, leftPaged.rows, leftSelectMode)}
                      indeterminate={someSelectedForScope(leftSelected, leftFiltered, leftPaged.rows, leftSelectMode)}
                      onChange={headerToggleLeft}
                    />
                  </th>
                  <th className="px-3 py-2 border">ID</th>
                  <th className="px-3 py-2 border">Name</th>
                  <th className="px-3 py-2 border">Class</th>
                </tr>
              </thead>
              <tbody>
                {leftPaged.rows.length > 0 && (
                  <tr>
                    <td colSpan="4" className="px-3 py-1 text-xs text-gray-600">Selected: {leftSelected.size}</td>
                  </tr>
                )}
                {leftPaged.rows.length === 0 ? (
                  <tr><td colSpan="4" className="px-3 py-4 text-center text-gray-500">No eligible students.</td></tr>
                ) : leftPaged.rows.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 border"><input type="checkbox" checked={leftSelected.has(s.id)} onChange={() => toggleLeft(s.id)} /></td>
                    <td className="px-3 py-2 border whitespace-nowrap">{normalizeStudentId(s.student_identifier)}</td>
                    <td className="px-3 py-2 border">{s.name}</td>
                    <td className="px-3 py-2 border">{s.class || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TableFooter
            page={leftPage}
            setPage={setLeftPage}
            total={leftPaged.total}
            perPage={rowsPerPage}
            summary={`Eligible by class: ${leftSummary.display} | Total: ${leftFiltered.length}`}
          />
        </div>

        {/* Right: Session roster */}
        <div className="border rounded-lg bg-white flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium flex items-center justify-between">
            <span>Session Roster</span>
            {onProfileCards && (
              <button onClick={() => onProfileCards()} className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50">Profile Cards</button>
            )}
          </div>
          <TableFilters filter={rightFilter} setFilter={setRightFilter} disabled={loading} />
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border w-8">
                    <SelectAllHeader
                      mode={rightSelectMode}
                      setMode={setRightSelectMode}
                      checked={allSelectedForScope(rightSelected, rightFiltered.filter(s => !scoredSet.has(s.id)), rightPaged.rows.filter(s => !scoredSet.has(s.id)), rightSelectMode)}
                      indeterminate={someSelectedForScope(rightSelected, rightFiltered.filter(s => !scoredSet.has(s.id)), rightPaged.rows.filter(s => !scoredSet.has(s.id)), rightSelectMode)}
                      onChange={headerToggleRight}
                    />
                  </th>
                  <th className="px-3 py-2 border">ID</th>
                  <th className="px-3 py-2 border">Name</th>
                  <th className="px-3 py-2 border">Class</th>
                </tr>
              </thead>
              <tbody>
                {rightPaged.rows.length > 0 && (
                  <tr>
                    <td colSpan="4" className="px-3 py-1 text-xs text-gray-600">Selected: {rightSelected.size}</td>
                  </tr>
                )}
                {rightPaged.rows.length === 0 ? (
                  <tr><td colSpan="4" className="px-3 py-4 text-center text-gray-500">No students in roster.</td></tr>
                ) : rightPaged.rows.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 border">
                      {scoredSet.has(s.id) ? (
                        <span className="relative inline-flex items-center group" role="img" aria-label="Has scores (any station, including run); cannot remove">
                          <LockIcon title="Has scores (any station, including run); cannot remove" />
                          <span className="pointer-events-none absolute z-10 -top-8 left-0 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-[11px] text-white text-left opacity-0 group-hover:opacity-100 shadow">
                            Has scores (any station, including run); cannot remove
                          </span>
                        </span>
                      ) : (
                        <input type="checkbox" checked={rightSelected.has(s.id)} onChange={() => toggleRight(s.id)} />
                      )}
                    </td>
                    <td className="px-3 py-2 border whitespace-nowrap">{normalizeStudentId(s.student_identifier)}</td>
                    <td className="px-3 py-2 border">
                      {s.name}
                      {scoredSet.has(s.id) && (
                        <span className="relative inline-flex items-center ml-2 group">
                          <span className="text-[11px] text-green-700">scored</span>
                          <span className="pointer-events-none absolute z-10 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-[11px] text-white opacity-0 group-hover:opacity-100 shadow">
                            Has scores (any station, including run)
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border">{s.class || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TableFooter
            page={rightPage}
            setPage={setRightPage}
            total={rightPaged.total}
            perPage={rowsPerPage}
            summary={`Roster by class: ${rightSummary.display} | Total: ${rightFiltered.length}`}
          />
        </div>
      </div>

      {/* Move buttons */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={moveRight} disabled={!canManage || leftSelected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">
          Move Right &gt;&gt;</button>
        <button onClick={moveLeft} disabled={!canManage || rightSelected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">
          &lt;&lt; Move Left
        </button>
      </div>

      {message && <div className="text-sm text-gray-700">{message}</div>}
    </section>
  );
}

function applyFilters(rows, f) {
  const idq = (f.id || '').trim().toLowerCase();
  const nq = (f.name || '').trim().toLowerCase();
  const cq = (f.klass || '').trim().toLowerCase();
  return (rows || []).filter(r => (
    (!idq || String(r.student_identifier || '').toLowerCase().includes(idq)) &&
    (!nq || String(r.name || '').toLowerCase().includes(nq)) &&
    (!cq || String(r.class || '').toLowerCase().includes(cq))
  ));
}

function paginate(rows, page, perPage) {
  const total = rows.length;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const slice = rows.slice(start, end);
  return { rows: slice, total };
}

function summarizeByClass(rows) {
  const map = new Map();
  rows.forEach(r => {
    const k = r.class || '-';
    map.set(k, (map.get(k) || 0) + 1);
  });
  const pairs = Array.from(map.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { display: pairs.map(([k, v]) => `${k} (${v})`).join(', ') };
}

function toggleSet(prev, id) {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

function TableFilters({ filter, setFilter, disabled }) {
  return (
    <div className="p-2 border-b bg-white grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
      <input disabled={disabled} className="border rounded px-2 py-1" placeholder="Filter ID" value={filter.id} onChange={e => setFilter({ ...filter, id: e.target.value })} />
      <input disabled={disabled} className="border rounded px-2 py-1" placeholder="Filter name" value={filter.name} onChange={e => setFilter({ ...filter, name: e.target.value })} />
      <input disabled={disabled} className="border rounded px-2 py-1" placeholder="Filter class" value={filter.klass} onChange={e => setFilter({ ...filter, klass: e.target.value })} />
    </div>
  );
}

function TableFooter({ page, setPage, total, perPage, summary }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="px-3 py-2 border-t bg-gray-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2">
        <button onClick={() => canPrev && setPage(page - 1)} disabled={!canPrev} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">Prev</button>
        <div>Page {page} / {totalPages}</div>
        <button onClick={() => canNext && setPage(page + 1)} disabled={!canNext} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">Next</button>
        <div className="text-gray-600">Rows per page: {perPage}</div>
      </div>
      {summary && <div className="text-gray-700">{summary}</div>}
    </div>
  );
}

function SelectAllHeader({ mode, setMode, checked, indeterminate, onChange }) {
  const [localChecked, setLocalChecked] = useState(!!checked);
  const cbRef = useRef(null);
  useEffect(() => { if (cbRef.current) cbRef.current.indeterminate = !!indeterminate; }, [indeterminate]);
  useEffect(() => { setLocalChecked(!!checked); }, [checked]);
  return (
    <div className="flex items-center gap-1">
      <input ref={cbRef} type="checkbox" checked={localChecked} onChange={(e) => { setLocalChecked(e.target.checked); onChange?.(e.target.checked); }} />
      <select className="text-[11px] border rounded px-1 py-0.5 bg-white" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="page">page</option>
        <option value="filter">filter</option>
      </select>
    </div>
  );
}

function allSelectedForScope(selectedSet, filtered, paged, mode) {
  const list = mode === 'filter' ? filtered : paged;
  if (!list.length) return false;
  return list.every(s => selectedSet.has(s.id));
}
function someSelectedForScope(selectedSet, filtered, paged, mode) {
  const list = mode === 'filter' ? filtered : paged;
  if (!list.length) return false;
  const some = list.some(s => selectedSet.has(s.id));
  const all = list.every(s => selectedSet.has(s.id));
  return some && !all;
}

function LockIcon({ title }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-gray-500" aria-label={title} title={title}>
      <path d="M6 10V8a6 6 0 1112 0v2h1a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V11a1 1 0 011-1h1zm2 0h8V8a4 4 0 10-8 0v2z"/>
    </svg>
  );
}








