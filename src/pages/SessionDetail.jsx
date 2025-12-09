import { useEffect, useMemo, useState } from "react";
import AttemptEditor from "../components/AttemptEditor";
import { jsPDF } from "jspdf";
import { drawBarcode } from "../utils/barcode";
import { drawQrDataUrl } from "../utils/qrcode";
import { normalizeStudentId } from "../utils/ids";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";
import { fmtRun } from "../lib/scores";
import RosterDualList from "../components/RosterDualList";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];

function RosterRow({ s, sessionId, canRecord, onSaved }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <tr>
                <td className="px-3 py-2 border">{normalizeStudentId(s.student_identifier)}</td>
                <td className="px-3 py-2 border">{s.name}</td>
                <td className="px-3 py-2 border">
                    <button onClick={() => canRecord && setOpen(v => !v)} disabled={!canRecord} className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm">
                        {open ? 'Close' : (canRecord ? 'Record' : 'View')}
                    </button>
                </td>
            </tr>
            {open && (
                <tr>
                    <td colSpan="3" className="px-3 py-3 border bg-gray-50">
                        <AttemptEditor sessionId={sessionId} studentId={s.id} onSaved={onSaved} />
                    </td>
                </tr>
            )}
        </>
    );
}

export default function SessionDetail({ user }) {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [membership, setMembership] = useState(null);
    const [schoolName, setSchoolName] = useState("");
    const [membershipLoading, setMembershipLoading] = useState(true);
    const [membershipError, setMembershipError] = useState("");

    const [session, setSession] = useState(null);
    const [roster, setRoster] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editMode, setEditMode] = useState(() => !!(location?.state && location.state.edit));
    const [formState, setFormState] = useState({ title: "", session_date: "" });
    const [formSubmitting, setFormSubmitting] = useState(false);
    const [flash, setFlash] = useState("");
    const [scoresCount, setScoresCount] = useState(0);
    const [scoredSet, setScoredSet] = useState(new Set());
    const [inProgressSet, setInProgressSet] = useState(new Set());
    const [completedSet, setCompletedSet] = useState(new Set());
    const [scoresByStudent, setScoresByStudent] = useState(new Map());
    const [scoresPage, setScoresPage] = useState(1);
    const [scoresPageSize, setScoresPageSize] = useState(100);
    const [filterClass, setFilterClass] = useState("");
    const [filterQuery, setFilterQuery] = useState("");
    const [showCompleted, setShowCompleted] = useState(true);
    const [showIncomplete, setShowIncomplete] = useState(true);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [activeTab, setActiveTab] = useState(() => (location.hash === '#scores' ? 'scores' : 'roster'));

    const platformOwner = isPlatformOwner(user);
    const canManage = useMemo(() => platformOwner || ROLE_CAN_MANAGE.includes(membership?.role), [platformOwner, membership]);
    const rosterEditable = canManage && session?.status !== 'completed';

    const formatDDMMYYYY = (iso) => {
        if (!iso) return "";
        const d = new Date(iso);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    };
    const parseDDMMYYYY = (val) => {
        if (!val) return "";
        const m = /^([0-3]\d)\/([0-1]\d)\/(\d{4})$/.exec(val.trim());
        if (!m) return "";
        const dd = m[1], mm = m[2], yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
    };

    useEffect(() => {
        if (!user) return;
        setMembershipLoading(true);
        supabase
            .from("memberships")
            .select("id, school_id, role")
            .eq("user_id", user.id)
            .maybeSingle()
            .then(({ data, error: err }) => {
                if (err || !data) {
                    setMembershipError("Unable to determine school membership.");
                } else {
                    setMembership(data);
                }
            })
            .finally(() => setMembershipLoading(false));
    }, [user]);

    // Load school name for context (PDF/profile cards)
    useEffect(() => {
        if (!membership?.school_id) return;
        supabase
            .from('schools')
            .select('id,name')
            .eq('id', membership.school_id)
            .maybeSingle()
            .then(({ data }) => { setSchoolName(data?.name || ""); });
    }, [membership?.school_id]);

    useEffect(() => {
        if (!membership?.school_id || !id) return;
        setLoading(true);
        supabase
            .from("sessions")
            .select("*")
            .eq("id", id)
            .maybeSingle()
            .then(({ data, error: err }) => {
                if (err) {
                    setError(err.message || "Failed to load session.");
                    setSession(null);
                } else if (!data) {
                    setError("Session not found.");
                    setSession(null);
                } else if (data.school_id !== membership.school_id) {
                    setError("Access denied for this session.");
                    setSession(null);
                } else {
                    setSession(data);
                    setFormState({ title: data.title, session_date: formatDDMMYYYY(data.session_date) });
                    setError("");
                }
            })
            .finally(() => setLoading(false));
    }, [membership?.school_id, id]);

    useEffect(() => {
        if (!id) return;
        loadRoster();
        loadScoresCount();
        loadScoresMap();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    // Recompute counts whenever roster changes to keep progress in sync
    useEffect(() => {
        if (!id) return;
        // When roster updates (often after async fetch), refresh status sets
        loadScoresCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roster, id]);

    // Keep tab state in sync with URL hash
    useEffect(() => {
        const fromHash = location.hash === '#scores' ? 'scores' : 'roster';
        if (fromHash !== activeTab) setActiveTab(fromHash);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.hash]);

    useEffect(() => {
        const desiredHash = activeTab === 'scores' ? '#scores' : '#roster';
        if (location.hash !== desiredHash) {
            navigate({ hash: desiredHash }, { replace: true });
        }
    }, [activeTab, location.hash, navigate]);

    const loadRoster = async () => {
        const { data, error: err } = await supabase
            .from("session_roster")
            .select("student_id, students!inner(id, student_identifier, name, enrollments(class,academic_year))")
            .eq("session_id", id)
            .order("student_id", { ascending: true });
        if (err) return;
        const sessionYear = session?.session_date ? new Date(session.session_date).getFullYear() : null;
        const list = (data || []).map((r) => {
            const s = r.students || {};
            const ens = Array.isArray(s.enrollments) ? s.enrollments : [];
            let cls = '';
            if (sessionYear) {
                const m = ens.find(e => String(e.academic_year) === String(sessionYear));
                cls = m?.class || '';
            }
            if (!cls && ens.length) {
                const sorted = [...ens].sort((a,b)=> (b.academic_year||0)-(a.academic_year||0));
                cls = sorted[0]?.class || '';
            }
            return { id: s.id, student_identifier: s.student_identifier, name: s.name, class: cls };
        });
        setRoster(list);
    };

    // Reload roster when session year becomes available to compute class column
    useEffect(() => {
        if (!id) return;
        loadRoster();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.session_date]);

    // Sort scores table by Class (asc, natural) then Name (asc)
    const sortedRoster = useMemo(() => {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const copy = Array.isArray(roster) ? [...roster] : [];
        copy.sort((a,b) => {
            const ca = String(a.class || '');
            const cb = String(b.class || '');
            const cCmp = collator.compare(ca, cb);
            if (cCmp !== 0) return cCmp;
            const na = String(a.name || '');
            const nb = String(b.name || '');
            return collator.compare(na, nb);
        });
        return copy;
    }, [roster]);

    // Distinct classes for filter
    const classOptions = useMemo(() => {
        const set = new Set((roster || []).map(r => String(r.class || '').trim()).filter(Boolean));
        return Array.from(set).sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }, [roster]);

    // Apply class and completion filters
    const filteredSortedRoster = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        const list = sortedRoster.filter(s => {
            const matchClass = !filterClass || String(s.class||'') === filterClass;
            if (!matchClass) return false;
            const matchQuery = !q || (
                String(s.name || '').toLowerCase().includes(q) ||
                String(s.student_identifier || '').toLowerCase().includes(q) ||
                String(s.class || '').toLowerCase().includes(q)
            );
            if (!matchQuery) return false;
            const isCompleted = completedSet.has(s.id);
            const includeCompleted = showCompleted && isCompleted;
            const includeIncomplete = showIncomplete && !isCompleted;
            return includeCompleted || includeIncomplete;
        });
        return list;
    }, [sortedRoster, filterClass, filterQuery, showCompleted, showIncomplete, completedSet]);

    const loadScoresCount = async () => {
        // Pull all score rows for this session and derive status counts from non-null metrics
        const { data: rows, error: err } = await supabase
            .from('scores')
            .select('student_id, situps, shuttle_run, sit_and_reach, pullups, run_2400, broad_jump')
            .eq('session_id', id);
        if (err) return;
        // Completion requires the 5 non-run stations; run is optional for completion
        const requiredMetrics = ['situps','shuttle_run','sit_and_reach','pullups','broad_jump'];
        const byStudent = new Map((rows || []).map(r => [r.student_id, r]));
        const scored = new Set();
        const inprog = new Set();
        const completed = new Set();
        (roster || []).forEach(s => {
            const row = byStudent.get(s.id);
            if (!row) return; // no row yet => not started
            const nonNullCount = requiredMetrics.reduce((acc, k) => acc + (row[k] == null ? 0 : 1), 0);
            const hasAny = (nonNullCount > 0) || (row.run_2400 != null);
            if (hasAny) scored.add(s.id);
            if (nonNullCount === requiredMetrics.length) {
                completed.add(s.id);
            } else if (hasAny) {
                inprog.add(s.id);
            }
        });
        setScoredSet(scored);
        setInProgressSet(inprog);
        setCompletedSet(completed);
        setScoresCount(completed.size);
    };

    const loadScoresMap = async () => {
        const { data: rows, error: err } = await supabase
            .from('scores')
            .select('student_id, situps, shuttle_run, sit_and_reach, pullups, broad_jump, run_2400')
            .eq('session_id', id);
        if (err) return;
        const map = new Map();
        (rows || []).forEach(r => { map.set(r.student_id, r); });
        setScoresByStudent(map);
    };

    // Responsive scores table page size (100 desktop, 40 mobile)
    useEffect(() => {
        const calc = () => setScoresPageSize(window.innerWidth < 768 ? 40 : 100);
        calc();
        window.addEventListener('resize', calc);
        return () => window.removeEventListener('resize', calc);
    }, []);

    useEffect(() => {
        if (!flash) return;
        const timer = setTimeout(() => setFlash(""), 3500);
        return () => clearTimeout(timer);
    }, [flash]);

    const handleEditToggle = () => {
        if (!session) return;
        setFormState({ title: session.title, session_date: formatDDMMYYYY(session.session_date) });
        setEditMode((prev) => !prev);
        setFlash("");
    };

    const handleUpdate = async (event) => {
        event.preventDefault();
        if (!session) return;
        setFormSubmitting(true);
        try {
            const isoDate = parseDDMMYYYY(formState.session_date);
            if (!isoDate) throw new Error('Please enter date as DD/MM/YYYY');
            const { data, error: err } = await supabase
                .from("sessions")
                .update({ title: formState.title, session_date: isoDate })
                .eq("id", session.id)
                .select()
                .single();
            if (err) throw err;
            setSession(data);
            setEditMode(false);
            setFlash("Session updated successfully.");
        } catch (err) {
            setFlash(err.message || "Unable to update session.");
        } finally {
            setFormSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!session) return;
        const confirmDelete = window.confirm("Delete this session? This action cannot be undone.");
        if (!confirmDelete) return;
        const { error: err } = await supabase.from("sessions").delete().eq("id", session.id);
        if (err) {
            setFlash(err.message || "Failed to delete session.");
            return;
        }
        navigate("/sessions");
    };

    const handleRemoveFromRoster = async (studentId) => {
        try {
            const { error: err } = await supabase
                .from('session_roster')
                .delete()
                .match({ session_id: id, student_id: studentId });
            if (err) throw err;
            setFlash('Removed from roster.');
            await loadRoster();
            await loadScoresCount();
        } catch (err) {
            setFlash(err.message || 'Failed to remove from roster.');
        }
    };

    
    // Build PFT-shaped rows with attendance/date logic
    const buildPftRows = async () => {
        try {
            const templateRes = await fetch('/pft_template.csv', { cache: 'no-store' });
            if (!templateRes.ok) throw new Error('Failed to load PFT template.');
            let templateText = await templateRes.text();
            // Keep only the first 21 rows of the template (row 21 is header)
            const tmplLines = templateText.replace(/\r\n/g, '\n').split('\n');
            const first21 = tmplLines.slice(0, 21).join('\n');
            const prefix = first21.endsWith('\n') ? first21 : (first21 + '\n');

            const headers = [
                'Sl.No','Name','ID','Class','Gender','DOB','Attendance',
                'Sit-ups','Standing Broad Jump (cm)','Sit & Reach (cm)','Pull-ups','Shuttle Run (sec)','1.6/2.4 Km Run MMSS','PFT Test Date'
            ];

            let shaped = [];
            let pftError = null;
            try {
                const { data: rows, error } = await supabase
                    .rpc('export_session_scores_pft', { p_session_id: id });
                if (error) throw error;
                shaped = (rows || []).map(r => {
                    const hasAny = (
                        r['Sit-ups'] != null ||
                        r['Standing Broad Jump (cm)'] != null ||
                        r['Sit & Reach (cm)'] != null ||
                        r['Pull-ups'] != null ||
                        r['Shuttle Run (sec)'] != null
                    );
                    return {
                        'Sl.No': r['Sl.No'],
                        'Name': r['Name'],
                        'ID': normalizeStudentId(r['ID']),
                        'Class': r['Class'],
                        'Gender': r['Gender'],
                        'DOB': r['DOB'],
                        'Attendance': hasAny ? 'P' : '',
                        'Sit-ups': r['Sit-ups'],
                        'Standing Broad Jump (cm)': r['Standing Broad Jump (cm)'],
                        'Sit & Reach (cm)': r['Sit & Reach (cm)'],
                        'Pull-ups': r['Pull-ups'],
                        'Shuttle Run (sec)': r['Shuttle Run (sec)'],
                        '1.6/2.4 Km Run MMSS': r['1.6/2.4 Km Run MMSS'] || '',
                        'PFT Test Date': hasAny ? (function(){ try { return formatDDMMYYYY(session?.session_date); } catch { return ''; } })() : ''
                    };
                });
            } catch (e) {
                pftError = e;
            }

            if (pftError || shaped.length === 0) {
                // Fallback to generic export and shape client-side
                const { data: raw, error } = await supabase
                    .rpc('export_session_scores', { p_session_id: id });
                if (error) throw error;
                shaped = (raw || []).map((r, i) => {
                    const hasAny = (
                        r.situps != null ||
                        r.broad_jump != null ||
                        r.sit_and_reach != null ||
                        r.pullups != null ||
                        r.shuttle_run != null
                    );
                    return {
                        'Sl.No': i + 1,
                        'Name': r.name || '',
                        'ID': normalizeStudentId(r.student_identifier || ''),
                        'Class': r.class || '',
                        'Gender': r.gender || '',
                        'DOB': r.dob || '',
                        'Attendance': hasAny ? 'P' : '',
                        'Sit-ups': r.situps,
                        'Standing Broad Jump (cm)': r.broad_jump,
                        'Sit & Reach (cm)': r.sit_and_reach,
                        'Pull-ups': r.pullups,
                        'Shuttle Run (sec)': r.shuttle_run,
                        '1.6/2.4 Km Run MMSS': '',
                        'PFT Test Date': hasAny ? (function(){ try { return formatDDMMYYYY(session?.session_date); } catch { return ''; } })() : ''
                    };
                });
            }

            return { headers, prefix, shaped };
        } catch (err) {
            setFlash(err.message || 'Failed to export results.');
            return null;
        }
    };

    const exportPftAllClasses = async () => {
        const res = await buildPftRows();
        if (!res) return;
        const { headers, prefix, shaped } = res;
        const dataRows = shaped.map(row => {
            const cols = headers.map(h => {
                const v = row[h];
                return v == null ? '' : (typeof v === 'string' ? '"' + v.replace(/"/g,'""') + '"' : v);
            });
            cols.push('*END*');
            return cols.join(',');
        });
        const finalCsv = "\uFEFF" + prefix + dataRows.join('\n');
        const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = String(session?.title || 'Session');
        const safeTitle = title.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        const d = new Date(session?.session_date);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const ddmmyyyy = `${dd}${mm}${yyyy}`;
        const fileName = `PFT_${safeTitle}_${ddmmyyyy}.csv`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try {
            const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
            const sid = validUuid(id) ? id : null;
            const sch = validUuid(membership?.school_id) ? membership.school_id : null;
            await supabase.rpc('audit_log_event', {
                p_entity_type: 'export_pft',
                p_action: 'download',
                p_entity_id: null,
                p_school_id: sch,
                p_session_id: sid,
                p_details: { mode: 'all_classes', file: fileName, rows: shaped.length }
            });
        } catch {}
    };

    const exportPftPerClass = async () => {
        const res = await buildPftRows();
        if (!res) return;
        const { headers, prefix, shaped } = res;
        // Group by class and generate one file per class, with Sl.No reset per class
        const byClass = new Map();
        shaped.forEach(r => {
            const k = (r['Class'] || '').toString().trim() || 'Unassigned';
            if (!byClass.has(k)) byClass.set(k, []);
            byClass.get(k).push(r);
        });
        const title = String(session?.title || 'Session');
        const safeTitle = title.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        const d = new Date(session?.session_date);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const ddmmyyyy = `${dd}${mm}${yyyy}`;
        for (const [klass, rowsForClass] of byClass.entries()) {
            const rowsWithReset = rowsForClass.map((row, idx) => ({ ...row, 'Sl.No': idx + 1 }));
            const dataRows = rowsWithReset.map(row => {
                const cols = headers.map(h => {
                    const v = row[h];
                    return v == null ? '' : (typeof v === 'string' ? '"' + v.replace(/"/g,'""') + '"' : v);
                });
                cols.push('*END*');
                return cols.join(',');
            });
            const finalCsv = "\uFEFF" + prefix + dataRows.join('\n');
            const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeClass = klass.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'Unassigned';
            const fileName = `PFT_${safeTitle}_${ddmmyyyy}_${safeClass}.csv`;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            try {
                const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                const sid = validUuid(id) ? id : null;
                const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                await supabase.rpc('audit_log_event', {
                    p_entity_type: 'export_pft',
                    p_action: 'download',
                    p_entity_id: null,
                    p_school_id: sch,
                    p_session_id: sid,
                    p_details: { mode: 'per_class', class: klass, file: fileName, rows: rowsForClass.length }
                });
            } catch {}
        }
    };
    const handleStatusChange = async (nextStatus) => {
        if (!session || session.status === nextStatus) return;
        if (nextStatus === 'completed') {
            const ok = window.confirm('Mark session as completed? Scores can no longer be recorded.');
            if (!ok) return;
        }
        setStatusUpdating(true);
        try {
            const { data, error: err } = await supabase
                .from('sessions')
                .update({ status: nextStatus })
                .eq('id', session.id)
                .select()
                .single();
            if (err) throw err;
            setSession(data);
            setFlash(`Status set to ${nextStatus}.`);
        } catch (err) {
            setFlash(err.message || 'Failed to update status.');
        } finally {
            setStatusUpdating(false);
        }
    };

    const downloadProfileCardsPdf = async () => {
        try {
            const { data, error } = await supabase
                .from('session_roster')
                .select('students!inner(id, student_identifier, name, enrollments!left(class, is_active))')
                .eq('session_id', id)
                .order('student_id', { ascending: true });
            if (error) throw error;
            const list = (data || []).map(r => {
                const enr = r.students?.enrollments;
                const activeClass = Array.isArray(enr) ? (enr.find(e => e?.is_active)?.class) : (enr?.class);
                return { id: r.students.id, student_identifier: r.students.student_identifier, name: r.students.name, class: activeClass || '' };
            }).sort((a, b) => (String(a.class||'').localeCompare(String(b.class||''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.name||'').localeCompare(String(b.name||''), undefined, { sensitivity: 'base' })));
            if (!list.length) { setFlash('No students in roster.'); return; }

            const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
            const pageW = 210, pageH = 297;
            const margin = 8; // add small printer-safe margins
            const cols = 2, rows = 4;
            const usableW = pageW - margin * 2;
            const usableH = pageH - margin * 2;
            const cellW = usableW / cols;
            const cellH = usableH / rows;
            const qrSize = 28; // mm

            // Helper canvases for barcode and QR
            const bcCanvas = document.createElement('canvas');
            const qrCanvas = document.createElement('canvas');

            const titleLine = String(session?.title || "");
            const schoolLine = String(schoolName || "");

            // Helper: truncate text to fit max width (mm) without wrapping
            const truncateToWidth = (text, maxW, fontSize) => {
                if (!text) return '';
                doc.setFontSize(fontSize);
                const ellipsis = '...';
                let t = String(text);
                // Fast path: fits
                if (doc.getTextWidth(t) <= maxW) return t;
                // Trim until fits, then add ellipsis if room
                while (t.length > 0 && doc.getTextWidth(t + ellipsis) > maxW) {
                    t = t.slice(0, -1);
                }
                return t.length ? (t + ellipsis) : '';
            };

            // Group by class so each class starts on a fresh page
            const groups = [];
            let curClass = null;
            list.forEach((s) => {
                const k = s.class || '';
                if (k !== curClass) { groups.push({ klass: k, items: [] }); curClass = k; }
                groups[groups.length - 1].items.push(s);
            });

            let idxInPage = 0;
            const capacity = cols * rows;
            const ensureNewPage = () => { if (idxInPage !== 0) { doc.addPage(); idxInPage = 0; } };

            for (const grp of groups) {
                // start new class on a new page
                ensureNewPage();
                for (const s of grp.items) {
                    const col = idxInPage % cols;
                    const row = Math.floor(idxInPage / cols);
                    const x0 = margin + col * cellW;
                    const y0 = margin + row * cellH;

                // Draw barcode and QR to canvases with high resolution for print
                const pxPerMm = 300 / 25.4; // 300 DPI target
                const targetQrPx = Math.round(qrSize * pxPerMm);
                // Compute intended barcode width in mm to match layout then convert to px
                const intendedBcWmm = cellW - qrSize - 12;
                const targetBcWpx = Math.max(300, Math.round(intendedBcWmm * pxPerMm));
                const targetBcHpx = Math.round(14 * pxPerMm); // slightly taller for better reads
                // Render CODE128 with generous quiet zone
                const idNorm = normalizeStudentId(s.student_identifier)
                drawBarcode(bcCanvas, idNorm, { format: 'CODE128', width: 2, height: targetBcHpx, margin: 24 });
                // If generated width is smaller/larger than target, it's OK; PDF scales the image retaining resolution
                const bcUrl = bcCanvas.toDataURL('image/png');
                const qrUrl = await drawQrDataUrl(idNorm, targetQrPx, 'M', 1);

                // Card border
                doc.setDrawColor(180);
                doc.setLineWidth(0.3);
                doc.rect(x0 + 2, y0 + 2, cellW - 4, cellH - 4);

                // Text
                doc.setFontSize(14);
                doc.text(String(idNorm), x0 + 6, y0 + 12);
                doc.setFontSize(12);
                doc.text(s.name || '', x0 + 6, y0 + 20);
                doc.text((s.class || ''), x0 + 6, y0 + 26);

                // Images
                // QR on right
                doc.addImage(qrUrl, 'PNG', x0 + cellW - qrSize - 6, y0 + 8, qrSize, qrSize);
                // Barcode bottom spans width minus QR area
                const bcW = cellW - qrSize - 12;
                // Reserve a footer band above barcode for school and session title
                const footerH = 10; // mm (two small text lines)
                const gap = 2;      // mm gap between footer and barcode
                const bottomPad = 4; // bottom padding
                const bcH = 12;     // reduce slightly to make space
                const bcY = y0 + cellH - bottomPad - bcH; // barcode sits above bottom padding

                // Footer band (draw text, not a filled rect). Centered text, truncated to fit cell width - paddings
                const textPadX = 6; // left/right text padding inside cell
                const maxTextW = cellW - textPadX * 2;
                const line1 = truncateToWidth(schoolLine, maxTextW, 9);
                const line2 = truncateToWidth(titleLine, maxTextW, 9);
                const footerBottomY = bcY - gap; // band sits directly above barcode
                const line2Y = footerBottomY - 1; // small inner padding
                const line1Y = line2Y - 4; // line spacing ~4mm
                doc.setFontSize(9);
                if (line1) doc.text(line1, x0 + cellW / 2, line1Y, { align: 'center' });
                if (line2) doc.text(line2, x0 + cellW / 2, line2Y, { align: 'center' });

                // Draw barcode
                doc.addImage(bcUrl, 'PNG', x0 + 6, bcY, bcW, bcH);
                idxInPage++;
                if (idxInPage >= capacity) { doc.addPage(); idxInPage = 0; }
            }
            }

            // Filename: (session_title)_(ddmmyyyy)_profilecards.pdf
            const d = new Date(session.session_date);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const ddmmyyyy = `${dd}${mm}${yyyy}`;
            const safeTitle = String(session?.title || 'session')
                .trim()
                .replace(/[\\/:*?"<>|]+/g, '')
                .replace(/\s+/g, '_');
            doc.save(`${safeTitle}_${ddmmyyyy}_profilecards.pdf`);
            try {
                const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                const sid = validUuid(id) ? id : null;
                const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                await supabase.rpc('audit_log_event', {
                    p_entity_type: 'profile_cards',
                    p_action: 'download',
                    p_entity_id: null,
                    p_school_id: sch,
                    p_session_id: sid,
                    p_details: { file: `${safeTitle}_${ddmmyyyy}_profilecards.pdf`, count: list.length }
                });
            } catch {}
        } catch (err) {
            setFlash(err.message || 'Failed to generate cards PDF.');
        }
    };

    if (!user) {
        return <div className="p-6">Please login.</div>;
    }

    if (membershipLoading || loading) {
        return <div className="p-6">Loading session...</div>;
    }

    if (membershipError || error) {
        return <div className="p-6 text-red-600">{membershipError || error}</div>;
    }

    if (!session) {
        return <div className="p-6">Session not available.</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <button onClick={() => navigate(-1)} className="text-sm text-blue-600 hover:underline">
                Back
            </button>
            <div className="sticky top-0 z-30 -mx-6 px-6 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
                <header className="py-3 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-3xl font-semibold text-gray-800">{session.title}</h1>
                        <span className="text-sm text-gray-600">
                            {(() => { const d = new Date(session.session_date); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}/${mm}/${yyyy}`; })()}
                        </span>
                        <span className={"text-xs px-2 py-1 rounded border " + (session.status === "completed" ? "bg-gray-200 text-gray-700" : (session.status === "active" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-800"))}>
                            {session.status}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                            <div className="text-xs text-gray-600 flex items-center gap-1">
                                <span>Change status</span>
                                <select
                                    className="text-xs border rounded px-2 py-1 bg-white w-auto"
                                    disabled={!canManage || statusUpdating}
                                    value={session.status}
                                    onChange={(e) => handleStatusChange(e.target.value)}
                                >
                                    <option value="draft">draft</option>
                                    <option value="active">active</option>
                                    <option value="completed">completed</option>
                                </select>
                            </div>
            

                            {/* header actions intentionally minimal; profile cards moved to roster tab */}
                        </div>
                    </div>
                </header>
                {/* Mobile summary toggle */}
                <div className="sm:hidden pb-1 flex items-center justify-between">
                    <button onClick={() => setSummaryOpen(v => !v)} className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50">
                        {summaryOpen ? 'Hide summary' : 'Show summary'}
                    </button>
                </div>
                {/* Summary (sticky). Visible on sm+, toggle on mobile */}
                <div className={(summaryOpen ? '' : 'hidden ') + 'sm:block pb-3 space-y-2'}>
                    {(() => {
                        const total = roster?.length || 0;
                        const completed = completedSet.size;
                        const inProgress = inProgressSet.size;
                        const notStarted = Math.max(0, total - completed - inProgress);
                        const pct = (n) => total ? Math.round((n * 100) / total) : 0;
                        const pctCompleted = pct(completed);
                        return (
                            <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">Total</div>
                                        <div className="text-base font-semibold">{total}</div>
                                    </div>
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">Not started</div>
                                        <div className="text-base font-semibold">{notStarted}</div>
                                    </div>
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">In progress</div>
                                        <div className="text-base font-semibold">{inProgress}</div>
                                    </div>
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">Completed</div>
                                        <div className="text-base font-semibold">{completed}</div>
                                    </div>
                                </div>
                                {/* Stacked progress bar: Not started | In progress | Completed */}
                                <div className="mt-2">
                                    {(() => {
                                        const pctInProgress = pct(inProgress);
                                        const pctNotStarted = pct(notStarted);
                                        return (
                                            <>
                                                <div className="flex h-2 w-full rounded overflow-hidden bg-gray-200">
                                                    {/* Not started */}
                                                    <div className="bg-gray-300" style={{ width: `${pctNotStarted}%` }} aria-label={`Not started ${pctNotStarted}%`} />
                                                    {/* In progress */}
                                                    <div className="bg-amber-400" style={{ width: `${pctInProgress}%` }} aria-label={`In progress ${pctInProgress}%`} />
                                                    {/* Completed */}
                                                    <div className="bg-green-500" style={{ width: `${pctCompleted}%` }} aria-label={`Completed ${pctCompleted}%`} />
                                                </div>
                                                <div className="mt-1 text-[11px] text-gray-600 flex gap-4 flex-wrap">
                                                    <span>
                                                        <span className="inline-block w-2 h-2 rounded-sm bg-gray-300 mr-1 align-middle" />
                                                        {notStarted}/{total} ({pctNotStarted}%) not started
                                                    </span>
                                                    <span>
                                                        <span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1 align-middle" />
                                                        {inProgress}/{total} ({pctInProgress}%) in progress
                                                    </span>
                                                    <span>
                                                        <span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-1 align-middle" />
                                                        {completed}/{total} ({pctCompleted}%) completed
                                                    </span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </>
                        );
                    })()}
                    {/* Tabs moved out of sticky header */}
                </div>
            </div>

            {/* Animated flash */}
            <div>
                {flash && <div className="text-sm text-blue-600 transition-all duration-200">{flash}</div>}
            </div>


            {/* Status/role banner */}
            <div className="text-sm">
                {session.status === "completed" && (
                    <div className="mb-3 px-3 py-2 rounded border bg-gray-50 text-gray-700">
                        Session is completed. Scores and roster are read-only.
                    </div>
                )}
                {session.status !== "completed" && membership?.role === "score_taker" && (
                    <div className="mb-3 px-3 py-2 rounded border bg-yellow-50 text-yellow-800">
                        You are a score_taker. You can record scores while the session is Active. Session settings and roster are admin-only.
                    </div>
                )}
            </div>

            <section className="space-y-4">
                {canManage ? (
                    editMode ? (
                        <form className="space-y-3 max-w-md" onSubmit={handleUpdate}>
                            <div>
                                <label className="block text-sm mb-1">Title</label>
                                <input
                                    value={formState.title}
                                    onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
                                    className="border rounded p-2 w-full"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Session Date</label>
                                <input
                                    type="text"
                                    placeholder="DD/MM/YYYY"
                                    value={formState.session_date}
                                    onChange={(e) => setFormState((prev) => ({ ...prev, session_date: e.target.value }))}
                                    className="border rounded p-2 w-full"
                                    required
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleEditToggle}
                                    className="px-4 py-2 border rounded hover:bg-gray-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={formSubmitting}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {formSubmitting ? "Saving..." : "Save"}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleEditToggle}
                                className="px-4 py-2 border rounded hover:bg-gray-100"
                            >
                                Edit Session
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50"
                            >
                                Delete Session
                            </button>
                        </div>
                        
                    )
                ) : (
                    <p className="text-sm text-gray-500">You have view-only access to this session.</p>
                )}
            </section>
            {/* Tabs (outside sticky header) */}
            <nav className="pb-2 overflow-x-auto">
                <div role="tablist" aria-label="Session sections" className="inline-flex rounded-lg bg-gray-100 p-1 text-sm">
                    <button
                        role="tab"
                        aria-selected={activeTab === 'roster'}
                        className={(activeTab === 'roster'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('roster')}
                    >
                        Roster
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === 'scores'}
                        className={(activeTab === 'scores'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('scores')}
                    >
                        Scores
                    </button>
                </div>
            </nav>

            {/* old tabs markup removed */}

            {activeTab === 'roster' ? (
                <RosterDualList
                  user={user}
                  session={session}
                  canManage={rosterEditable}
                  membership={membership}
                  onProfileCards={downloadProfileCardsPdf}
                />
            ) : (
                <section className="space-y-4">
                    <div className="border rounded-lg overflow-x-auto bg-white">
                        <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span>Scores</span>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-600">Class</label>
                                    <select value={filterClass} onChange={e => { setScoresPage(1); setFilterClass(e.target.value) }} className="text-xs border rounded px-2 py-1 bg-white">
                                        <option value="">All</option>
                                        {classOptions.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-600">Search</label>
                                    <input
                                        type="text"
                                        value={filterQuery}
                                        onChange={e => { setScoresPage(1); setFilterQuery(e.target.value) }}
                                        placeholder="Name or ID"
                                        className="text-xs border rounded px-2 py-1 bg-white"
                                    />
                                </div>
                                <div className="flex items-center gap-3 text-xs">
                                    <label className="inline-flex items-center gap-1">
                                        <input type="checkbox" className="align-middle" checked={showCompleted} onChange={e => { setScoresPage(1); setShowCompleted(e.target.checked) }} />
                                        <span>Show completed</span>
                                    </label>
                                    <label className="inline-flex items-center gap-1">
                                        <input type="checkbox" className="align-middle" checked={showIncomplete} onChange={e => { setScoresPage(1); setShowIncomplete(e.target.checked) }} />
                                        <span>Show incomplete</span>
                                    </label>
                                </div>
                                <div className="text-xs text-gray-500">Sorting: Class ▲, Name ▲</div>
                            </div>
                            {canManage && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={exportPftAllClasses}
                                        className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                    >
                                        Export PFT (All Classes)
                                    </button>
                                    <button
                                        onClick={exportPftPerClass}
                                        className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                    >
                                        Export PFT (Per Class)
                                    </button>
                                </div>
                            )}
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-100 text-left">
                                    <th className="px-3 py-2 border">Student ID</th>
                                    <th className="px-3 py-2 border">Name</th>
                                    <th className="px-3 py-2 border">Class</th>
                                    <th className="px-3 py-2 border">Sit-ups</th>
                                    <th className="px-3 py-2 border">Shuttle Run</th>
                                    <th className="px-3 py-2 border">Sit & Reach</th>
                                    <th className="px-3 py-2 border">Pull-ups</th>
                                    <th className="px-3 py-2 border">Broad Jump</th>
                                    <th className="px-3 py-2 border">Run (mm:ss)</th>
                                    <th className="px-3 py-2 border w-40">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                            {(() => {
                                const total = filteredSortedRoster.length;
                                if (total === 0) return (
                                    <tr><td colSpan="10" className="px-3 py-4 text-center text-gray-500">No students in this session yet.</td></tr>
                                );
                                const totalPages = Math.max(1, Math.ceil(total / scoresPageSize));
                                const cur = Math.min(scoresPage, totalPages);
                                const start = (cur - 1) * scoresPageSize;
                                const pageItems = filteredSortedRoster.slice(start, start + scoresPageSize);
                                return pageItems.flatMap((s) => {
                                    const row = scoresByStudent.get(s.id) || {};
                                    const canRecord = session.status === 'active' && ['admin','superadmin','score_taker'].includes(membership?.role);
                                    const isCompleted = completedSet.has(s.id);
                                    const isInProgress = inProgressSet.has(s.id);
                                    const statusLeft = isCompleted
                                        ? 'border-l-4 border-l-green-500'
                                        : (isInProgress ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-gray-300');
                                    return [
                                        <tr key={s.id}>
                                            <td className={`px-3 py-2 border align-top ${statusLeft}`}>{normalizeStudentId(s.student_identifier)}</td>
                                            <td className="px-3 py-2 border align-top">{s.name}</td>
                                            <td className="px-3 py-2 border align-top">{s.class || '-'}</td>
                                            <td className="px-3 py-2 border align-top">{row.situps ?? '-'}</td>
                                            <td className="px-3 py-2 border align-top">{row.shuttle_run ?? '-'}</td>
                                            <td className="px-3 py-2 border align-top">{row.sit_and_reach ?? '-'}</td>
                                            <td className="px-3 py-2 border align-top">{row.pullups ?? '-'}</td>
                                            <td className="px-3 py-2 border align-top">{row.broad_jump ?? '-'}</td>
                                            <td className="px-3 py-2 border align-top">{fmtRun(row.run_2400) || '-'}</td>
                                            <td className="px-3 py-2 border align-top">
                                                <ScoreRowActions student={s} canRecord={canRecord} onSaved={async () => { await loadScoresMap(); await loadScoresCount(); }} sessionId={id} />
                                            </td>
                                        </tr>
                                    ];
                                });
                            })()}
                            </tbody>
                        </table>
                        {/* Pagination footer */}
                        <ScoresPager
                            total={roster.length}
                            page={scoresPage}
                            pageSize={scoresPageSize}
                            onPageChange={setScoresPage}
                        />
                    </div>
                </section>
            )}
        </div>
    );
}

function ScoresPager({ total, page, pageSize, onPageChange }) {
    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)));
    const cur = Math.min(page, totalPages);
    const start = total ? (cur - 1) * pageSize + 1 : 0;
    const end = Math.min(cur * pageSize, total);
    if (!total) return null;
    return (
        <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-sm">
            <div>Showing {start}-{end} of {total}</div>
            <div className="flex items-center gap-2">
                <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={cur <= 1} onClick={() => onPageChange(cur - 1)}>Prev</button>
                <span className="text-gray-600">Page {cur} of {totalPages}</span>
                <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={cur >= totalPages} onClick={() => onPageChange(cur + 1)}>Next</button>
            </div>
        </div>
    );
}

function ScoreRowActions({ student, sessionId, canRecord, onSaved }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button onClick={() => canRecord && setOpen(true)} disabled={!canRecord} className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm">
                {canRecord ? 'Edit' : 'View'}
            </button>
            {open && (
                <div className="fixed inset-0 z-40">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden="true" />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-xl shadow-lg">
                            <div className="px-4 py-3 border-b flex items-center justify-between">
                                <div className="font-medium">Edit Scores — {student.name}</div>
                                <button className="text-gray-500 hover:text-gray-800" aria-label="Close" onClick={() => setOpen(false)}>×</button>
                            </div>
                            <div className="p-4">
                                <AttemptEditor sessionId={sessionId} studentId={student.id} onSaved={() => { setOpen(false); onSaved && onSaved(); }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

 















