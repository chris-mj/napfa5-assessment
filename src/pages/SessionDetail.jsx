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
import { evaluateIppt3, awardForTotal } from "../utils/ippt3Standards";
import RosterDualList from "../components/RosterDualList";
import SessionHouses from "../components/SessionHouses";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];
const RESET_RUN_ENDPOINT = import.meta.env.DEV
    ? 'http://localhost:3000/api/run/resetConfig'
    : 'https://napfa5.sg/api/run/resetConfig';

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
    const isIppt3 = (session?.assessment_type || 'NAPFA5') === 'IPPT3';
    const [scoresPage, setScoresPage] = useState(1);
    const [scoresPageSize, setScoresPageSize] = useState(100);
    const [filterClass, setFilterClass] = useState("");
    const [filterQuery, setFilterQuery] = useState("");
    const [showCompleted, setShowCompleted] = useState(true);
    const [showIncomplete, setShowIncomplete] = useState(true);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [runConfigs, setRunConfigs] = useState([]);
    const [expandedRunConfigId, setExpandedRunConfigId] = useState(null);
    const [runConfigForm, setRunConfigForm] = useState({
        name: "",
        template_key: "A",
        laps_required: 3,
        enforcement: "OFF",
        scan_gap_ms: 10000
    });
    const [runConfigSaving, setRunConfigSaving] = useState(false);
    const [runConfigFlash, setRunConfigFlash] = useState("");
    const [activeTab, setActiveTab] = useState(() => {
        if (location.hash === '#scores') return 'scores';
        if (location.hash === '#houses') return 'houses';
        if (location.hash === '#run-setup') return 'run-setup';
        return 'roster';
    });

    // default scroll behavior; removed inline scroll memory per request

    // scroll-memory removed per request

    const platformOwner = isPlatformOwner(user);
    const canManage = useMemo(() => platformOwner || ROLE_CAN_MANAGE.includes(membership?.role), [platformOwner, membership]);
    const rosterEditable = canManage && session?.status !== 'completed';
    const checkpointTemplates = new Set(["B", "C"]);
    const defaultRunEnforcement = (templateKey) => (checkpointTemplates.has(templateKey) ? "SOFT" : "OFF");

    const formatDDMMYYYY = (iso) => {
        if (!iso) return "";
        const d = new Date(iso);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    };
    const calcAgeAt = (dobISO, when) => {
        if (!dobISO) return null;
        try {
            const birth = new Date(dobISO);
            const d = when instanceof Date ? when : new Date(when);
            let age = d.getFullYear() - birth.getFullYear();
            const m = d.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && d.getDate() < birth.getDate())) age--;
            return age;
        } catch { return null; }
    };
    // For input[type=date], value should be YYYY-MM-DD. Avoid timezone shifts by string slicing.
    const toInputDate = (iso) => {
        if (!iso) return "";
        const s = String(iso);
        return s.length >= 10 ? s.slice(0, 10) : "";
    };

    useEffect(() => {
        if (!user?.id) return;
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
    }, [user?.id]);

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
                    setFormState({ title: data.title, session_date: toInputDate(data.session_date) });
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
    }, [id, session?.assessment_type]);

    useEffect(() => {
        if (!id) return;
        loadRunConfigs();
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
        const fromHash = location.hash === '#scores'
            ? 'scores'
            : (location.hash === '#houses'
                ? 'houses'
                : (location.hash === '#run-setup' ? 'run-setup' : 'roster'));
        if (fromHash !== activeTab) setActiveTab(fromHash);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.hash]);

    useEffect(() => {
        const desiredHash = activeTab === 'scores'
            ? '#scores'
            : (activeTab === 'houses'
                ? '#houses'
                : (activeTab === 'run-setup' ? '#run-setup' : '#roster'));
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

    const loadRunConfigs = async () => {
        if (!id) return;
        const { data, error: err } = await supabase
            .from('run_configs')
            .select('*')
            .eq('session_id', id)
            .order('created_at', { ascending: false });
        if (err) return;
        setRunConfigs(data || []);
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
        if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
            const { data: rows, error: err } = await supabase
                .from('ippt3_scores')
                .select('student_id, situps, pushups, run_2400')
                .eq('session_id', id);
            if (err) return;
            const byStudent = new Map((rows || []).map(r => [r.student_id, r]));
            const scored = new Set();
            const inprog = new Set();
            const completed = new Set();
            (roster || []).forEach(s => {
                const row = byStudent.get(s.id);
                if (!row) return;
                const required = ['situps','pushups','run_2400'];
                const nonNull = required.reduce((acc,k)=> acc + (row[k] == null ? 0 : 1), 0);
                const hasAny = nonNull > 0;
                if (hasAny) scored.add(s.id);
                if (nonNull === required.length) completed.add(s.id);
                else inprog.add(s.id);
            });
            setScoredSet(scored);
            setInProgressSet(inprog);
            setCompletedSet(completed);
            setScoresCount(completed.size);
            return;
        }
        // NAPFA-5
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
        if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
            const { data: rows, error: err } = await supabase
                .from('ippt3_scores')
                .select('student_id, situps, pushups, run_2400')
                .eq('session_id', id);
            if (err) return;
            const map = new Map();
            (rows || []).forEach(r => { map.set(r.student_id, r); });
            setScoresByStudent(map);
            return;
        }
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

    useEffect(() => {
        if (!runConfigFlash) return;
        const timer = setTimeout(() => setRunConfigFlash(""), 3500);
        return () => clearTimeout(timer);
    }, [runConfigFlash]);

    const handleEditToggle = () => {
        if (!session) return;
        setFormState({ title: session.title, session_date: toInputDate(session.session_date) });
        setEditMode((prev) => !prev);
        setFlash("");
    };

    const handleUpdate = async (event) => {
        event.preventDefault();
        if (!session) return;
        setFormSubmitting(true);
        try {
            const isoDate = formState.session_date;
            if (!isoDate) throw new Error('Please select a date');
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

    const handleDownloadDataUrl = (dataUrl, fileName) => {
        if (!dataUrl) return;
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        link.click();
    };
    const handleCreateRunConfig = async () => {
        if (!session) return;
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const token = crypto.randomUUID();
            const payload = {
                session_id: session.id,
                name: runConfigForm.name || null,
                template_key: runConfigForm.template_key,
                laps_required: Number(runConfigForm.laps_required) || 1,
                enforcement: runConfigForm.enforcement,
                scan_gap_ms: Number(runConfigForm.scan_gap_ms) || 10000,
                pairing_token: token
            };
            const { data, error: err } = await supabase
                .from('run_configs')
                .insert(payload)
                .select()
                .single();
            if (err) throw err;
            setRunConfigForm({
                name: "",
                template_key: "A",
                laps_required: 3,
                enforcement: "OFF",
                scan_gap_ms: 10000
            });
            setRunConfigFlash("Run config created. Generate QR/barcode if needed.");
            await loadRunConfigs();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to create run config.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const updateRunConfigLocal = (configId, patch) => {
        setRunConfigs((prev) => prev.map((c) => {
            if (c.id !== configId) return c;
            const next = { ...c, ...patch };
            if (patch.template_key && !checkpointTemplates.has(patch.template_key)) {
                next.enforcement = "OFF";
            } else if (patch.template_key && checkpointTemplates.has(patch.template_key) && !next.enforcement) {
                next.enforcement = defaultRunEnforcement(patch.template_key);
            }
            return next;
        }));
    };

    const handleSaveRunConfig = async (config) => {
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const { error: err } = await supabase
                .from('run_configs')
                .update({
                    name: config.name || null,
                    template_key: config.template_key,
                    laps_required: Number(config.laps_required) || 1,
                    enforcement: config.enforcement,
                    scan_gap_ms: Number(config.scan_gap_ms) || 10000
                })
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("Run config saved.");
            await loadRunConfigs();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to save run config.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const handleGenerateRunToken = async (config) => {
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const token = crypto.randomUUID();
            const { error: err } = await supabase
                .from('run_configs')
                .update({
                    pairing_token: token,
                    pairing_qr_data_url: null,
                    pairing_barcode_data_url: null
                })
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("New token generated. Create QR/barcode if needed.");
            await loadRunConfigs();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to generate token.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const handleResetRunConfig = async (config) => {
        const confirmReset = window.confirm("Reset all synced run data for this config? Stations will need to resync after reset.");
        if (!confirmReset) return;
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const { data } = await supabase.auth.getSession();
            const accessToken = data?.session?.access_token;
            if (!accessToken) throw new Error("Missing login session.");
            const response = await fetch(RESET_RUN_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`
                },
                body: JSON.stringify({ runConfigId: config.id, sessionId: session.id })
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error || 'Failed to reset run data.');
            setRunConfigFlash("Run data reset. Ask stations to clear local data or wait for reset sync.");
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to reset run data.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const handleGenerateRunCodes = async (config) => {
        if (!session?.id || !config?.pairing_token) {
            setRunConfigFlash("Please generate or enter a pairing token first.");
            return;
        }
        try {
            const payload = `napfa5-run://pair?sessionId=${session.id}&runConfigId=${config.id}&token=${config.pairing_token}`;
            const qrUrl = await drawQrDataUrl(payload, 256, 'M', 1);
            const canvas = document.createElement('canvas');
            drawBarcode(canvas, payload, { width: 2, height: 80, margin: 12, displayValue: false });
            const barcodeUrl = canvas.toDataURL('image/png');
            const { error: err } = await supabase
                .from('run_configs')
                .update({ pairing_qr_data_url: qrUrl, pairing_barcode_data_url: barcodeUrl })
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("QR and barcode generated.");
            await loadRunConfigs();
        } catch {
            setRunConfigFlash("Failed to generate QR or barcode.");
        }
    };

    const handleCopyRunToken = async (token) => {
        if (!token) return;
        try {
            await navigator.clipboard.writeText(token);
            setRunConfigFlash("Token copied.");
        } catch {
            setRunConfigFlash("Unable to copy token.");
        }
    };

    const handleDeleteRunConfig = async (config) => {
        const confirmDelete = window.confirm("Delete this run config? This action cannot be undone.");
        if (!confirmDelete) return;
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const { error: err } = await supabase
                .from('run_configs')
                .delete()
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("Run config deleted.");
            await loadRunConfigs();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to delete run config.");
        } finally {
            setRunConfigSaving(false);
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
            if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
                const headers = ['S/N','Name','ID','Class','Gender','DOB','Attendance Status','Sit Up reps','Push-ups reps','2.4 Km Run MMSS','PFT Test Date','Sit Up score','Push-ups score','2.4 Km Run score','Total Points','Award'];
                const prefix = headers.join(',') + '\n';
                const { data: rosterRows, error: rErr } = await supabase
                    .from('session_roster')
                    .select('students:student_id(id, student_identifier, name, gender, dob, enrollments!left(class, is_active))')
                    .eq('session_id', id);
                if (rErr) throw rErr;
                const list = (rosterRows || []).map(rr => {
                    const st = rr.students || {};
                    const enr = st.enrollments;
                    const activeClass = Array.isArray(enr) ? (enr.find(e=>e?.is_active)?.class) : (enr?.class);
                    return { id: st.id, name: st.name || '', sid: st.student_identifier || '', gender: st.gender || '', dob: st.dob || '', class: activeClass || '' };
                });
                const { data: sRows } = await supabase
                    .from('ippt3_scores')
                    .select('student_id, situps, pushups, run_2400')
                    .eq('session_id', id);
                const byStu = new Map((sRows || []).map(r => [r.student_id, r]));
                const testDate = session?.session_date ? new Date(session.session_date) : new Date();
                const shaped = list.map((st, i) => {
                    const row = byStu.get(st.id) || {};
                    const hasAny = row.situps != null || row.pushups != null || row.run_2400 != null;
                    const age = calcAgeAt(st.dob, testDate);
                    const measures = {};
                    if (row.situps != null) measures.situps = Number(row.situps);
                    if (row.pushups != null) measures.pushups = Number(row.pushups);
                    if (row.run_2400 != null) measures.run_seconds = Math.round(Number(row.run_2400) * 60);
                    const hasRun = row.run_2400 != null;
                    const res = (st.gender && age != null) ? evaluateIppt3({ sex: st.gender, age }, measures) : null;
                    const sitPts = res?.stations?.situps?.points ?? 0;
                    const pushPts = res?.stations?.pushups?.points ?? 0;
                    const runPts = hasRun ? (res?.stations?.run?.points ?? 0) : 0;
                    const totalPts = hasRun ? (res?.totalPoints ?? (sitPts + pushPts + runPts)) : (sitPts + pushPts + runPts);
                    const awardRaw = st.gender ? awardForTotal(totalPts, st.gender) : '';
                    const awardLabel = awardRaw === 'Pass' ? 'Bronze' : (awardRaw || '');
                    return {
                        'S/N': i + 1,
                        'Name': st.name,
                        'ID': normalizeStudentId(st.sid),
                        'Class': st.class,
                        'Gender': st.gender,
                        'DOB': st.dob,
                        'Attendance Status': hasAny ? 'P' : '',
                        'Sit Up reps': row.situps ?? '',
                        'Push-ups reps': row.pushups ?? '',
                        '2.4 Km Run MMSS': (row.run_2400 != null ? (fmtRun(row.run_2400) || '') : ''),
                        'PFT Test Date': hasAny ? (function(){ try { return formatDDMMYYYY(session?.session_date); } catch { return ''; } })() : '',
                        'Sit Up score': sitPts || '',
                        'Push-ups score': pushPts || '',
                        '2.4 Km Run score': runPts || '',
                        'Total Points': Number.isFinite(totalPts) ? totalPts : '',
                        'Award': awardLabel
                    };
                });
                return { headers, prefix, shaped };
            }
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
                        <div className="ml-auto flex items-center gap-3 flex-wrap">
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
                            <div className="text-xs text-gray-600 flex items-center gap-1">
                                <span>Type</span>
                                {canManage ? (
                                  <select
                                    className="text-xs border rounded px-2 py-1 bg-white w-auto"
                                    disabled={!canManage || statusUpdating}
                                    value={session.assessment_type || 'NAPFA5'}
                                    onChange={async (e) => {
                                      const next = e.target.value;
                                      try {
                                        const [s1, s2] = await Promise.all([
                                          supabase.from('scores').select('id', { count: 'exact', head: true }).eq('session_id', id),
                                          supabase.from('ippt3_scores').select('id', { count: 'exact', head: true }).eq('session_id', id),
                                        ]);
                                        const total = (s1?.count || 0) + (s2?.count || 0);
                                        if (total > 0) { setFlash('Cannot change assessment type after scores are recorded.'); return; }
                                        const { data, error } = await supabase
                                          .from('sessions')
                                          .update({ assessment_type: next })
                                          .eq('id', id)
                                          .select()
                                          .single();
                                        if (error) throw error;
                                        setSession(data);
                                        setFlash('Assessment type updated.');
                                      } catch (err) {
                                        setFlash(err.message || 'Failed to update type.');
                                      }
                                    }}
                                  >
                                    <option value="NAPFA5">NAPFA-5</option>
                                    <option value="IPPT3">IPPT-3</option>
                                  </select>
                                ) : (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded border ${ (session.assessment_type||'NAPFA5') === 'IPPT3' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-teal-50 text-teal-700 border-teal-200' }`}>
                                    {(session.assessment_type||'NAPFA5') === 'IPPT3' ? 'IPPT-3' : 'NAPFA-5'}
                                  </span>
                                )}
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
                                    type="date"
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
                    <button
                        role="tab"
                        aria-selected={activeTab === 'houses'}
                        className={(activeTab === 'houses'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('houses')}
                    >
                        Houses
                    </button>
                    {canManage && (
                        <button
                            role="tab"
                            aria-selected={activeTab === 'run-setup'}
                            className={(activeTab === 'run-setup'
                                ? 'bg-white text-blue-700 shadow border border-gray-200'
                                : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                            onClick={() => setActiveTab('run-setup')}
                        >
                            Run Setup
                        </button>
                    )}
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
            ) : activeTab === 'houses' ? (
                <SessionHouses
                  session={session}
                  membership={membership}
                  canManage={rosterEditable}
                />
            ) : activeTab === 'run-setup' ? (
                <section className="space-y-4">
                    <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                        <div className="border rounded-lg bg-white p-4">
                            <div className="text-sm font-semibold text-gray-800 mb-2">How it works</div>
                            <div className="text-xs text-gray-600 space-y-2">
                                <div>1. Create a run config for a specific setup.</div>
                                <div>2. Generate the pairing token + QR/barcode.</div>
                                <div>3. Scan the token on each run device to join.</div>
                            </div>
                            <div className="text-sm font-semibold text-gray-800 mt-4 mb-3">Create Run Config</div>
                            <div className="text-xs text-gray-600 mb-3">
                                Create a run configuration and share its pairing token with run devices.
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {['A','B','C','D','E'].map((k) => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setRunConfigForm((prev) => ({
                                            ...prev,
                                            template_key: k,
                                            enforcement: defaultRunEnforcement(k)
                                        }))}
                                        className={`border rounded-lg p-0 text-left hover:border-blue-300 ${runConfigForm.template_key === k ? 'border-blue-500 bg-blue-50/40' : 'border-gray-200'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <img src={`/setup${k}.svg`} alt={`Setup ${k}`} className="w-64 h-64 object-contain" />
                                            <div className="max-w-[160px]">
                                                <div className="text-sm font-semibold">Setup {k}</div>
                                                <div className="text-xs text-gray-600">
                                                    {k === 'A' && 'Single scan (lap start/end)'}
                                                    {k === 'B' && 'Lap scan + Checkpoint A'}
                                                    {k === 'C' && 'Lap scan + Checkpoints A & B'}
                                                    {k === 'D' && 'Start + Lap scan'}
                                                    {k === 'E' && 'Lap scan + Finish'}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="text-xs text-gray-500 mt-2">
                                Setups B/C include checkpoint scans; others are single-lap scan points.
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3 mt-4">
                                <div>
                                    <label className="block text-sm mb-1">Config Name</label>
                                    <input
                                        value={runConfigForm.name}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                        placeholder="e.g., P5 Run Setup"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">Shown to staff only.</div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Laps Required</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={runConfigForm.laps_required}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, laps_required: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">Total laps needed to finish.</div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Checkpoint Enforcement</label>
                                    <select
                                        value={runConfigForm.enforcement}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, enforcement: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                        disabled={!checkpointTemplates.has(runConfigForm.template_key)}
                                    >
                                        {['OFF','SOFT','STRICT'].map((k) => (
                                            <option key={k} value={k}>{k}</option>
                                        ))}
                                    </select>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Used only in Setup B/C. Default OFF for A/D/E, SOFT for B/C.
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Time Between Scans</label>
                                    <select
                                        value={runConfigForm.scan_gap_ms}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, scan_gap_ms: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                    >
                                        {[5,10,15,20,25,30].map((s) => (
                                            <option key={s} value={s * 1000}>{s} seconds</option>
                                        ))}
                                    </select>
                                    <div className="text-xs text-gray-500 mt-1">Debounce window per runner.</div>
                                </div>
                            </div>
                            <div className="pt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleCreateRunConfig}
                                    disabled={runConfigSaving}
                                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {runConfigSaving ? 'Saving...' : 'Create Run Config'}
                                </button>
                            </div>
                        </div>

                        <div className="border rounded-lg bg-white p-4">
                            <div className="text-sm font-semibold text-gray-800 mb-2">Run Configs</div>
                            {runConfigs.length === 0 && (
                                <div className="text-sm text-gray-600">No run configurations yet.</div>
                            )}
                            <div className="space-y-2">
                                {runConfigs.map((config) => {
                                const expanded = expandedRunConfigId === config.id;
                                return (
                                    <div key={config.id} className="border rounded-lg">
                                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                                            <div className="flex items-center gap-3">
                                                <img src={`/setup${config.template_key}.svg`} alt={`Setup ${config.template_key}`} className="w-12 h-12 object-contain" />
                                                <div>
                                                    <div className="text-sm font-semibold text-gray-800">
                                                        {config.name || `Run Config ${config.id?.slice(0, 6)}`}
                                                    </div>
                                                    <div className="text-xs text-gray-600">
                                                        Setup {config.template_key} - Laps {config.laps_required} - Enforcement {config.enforcement || 'OFF'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedRunConfigId(expanded ? null : config.id)}
                                                    className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                >
                                                    {expanded ? 'Hide' : 'Edit'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteRunConfig(config)}
                                                    className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        {expanded && (
                                            <div className="border-t px-3 py-3 space-y-3">
                                                <div className="grid sm:grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs mb-1">Config Name</label>
                                                        <input
                                                            value={config.name || ''}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { name: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Template</label>
                                                        <select
                                                            value={config.template_key}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { template_key: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        >
                                                            {['A','B','C','D','E'].map((k) => (
                                                                <option key={k} value={k}>Setup {k}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Laps Required</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={config.laps_required}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { laps_required: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Checkpoint Enforcement</label>
                                                        <select
                                                            value={config.enforcement || 'OFF'}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { enforcement: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                            disabled={!checkpointTemplates.has(config.template_key)}
                                                        >
                                                            {['OFF','SOFT','STRICT'].map((k) => (
                                                                <option key={k} value={k}>{k}</option>
                                                            ))}
                                                        </select>
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            Used only in Setup B/C.
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Time Between Scans</label>
                                                        <select
                                                            value={config.scan_gap_ms || 10000}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { scan_gap_ms: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        >
                                                            {[5,10,15,20,25,30].map((s) => (
                                                                <option key={s} value={s * 1000}>{s} seconds</option>
                                                            ))}
                                                        </select>
                                                        <div className="text-xs text-gray-500 mt-1">Debounce window per runner.</div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Pairing Token</label>
                                                        <input
                                                            value={config.pairing_token || ''}
                                                            readOnly
                                                            className="border rounded p-2 w-full bg-gray-50"
                                                        />
                                                        <div className="text-xs text-gray-500 mt-1">Use this token in the run app.</div>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveRunConfig(config)}
                                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleGenerateRunToken(config)}
                                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                    >
                                                        Generate Token
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleGenerateRunCodes(config)}
                                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                    >
                                                        Create QR + Barcode
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyRunToken(config.pairing_token)}
                                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                        disabled={!config.pairing_token}
                                                    >
                                                        Copy Token
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleResetRunConfig(config)}
                                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                    >
                                                        Reset Run Data
                                                    </button>
                                                </div>
                                                <div className="text-xs text-amber-600">Warning: reset deletes synced run events for this config. Stations should clear local data.</div>
                                                {runConfigFlash && <div className="text-xs text-blue-600">{runConfigFlash}</div>}
                                                {(config.pairing_qr_data_url || config.pairing_barcode_data_url) && (
                                                    <div className="grid sm:grid-cols-2 gap-3 pt-2">
                                                        <div className="border rounded-lg bg-gray-50 p-2 flex flex-col items-center gap-2">
                                                            {config.pairing_qr_data_url ? (
                                                                <img src={config.pairing_qr_data_url} alt="Pairing QR" className="w-40 h-40 object-contain" />
                                                            ) : (
                                                                <div className="text-xs text-gray-500">No QR generated yet.</div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadDataUrl(config.pairing_qr_data_url, `pairing-${config.id}-qr.png`)}
                                                                className="text-xs px-3 py-1 border rounded hover:bg-gray-100"
                                                                disabled={!config.pairing_qr_data_url}
                                                            >
                                                                Download QR
                                                            </button>
                                                        </div>
                                                        <div className="border rounded-lg bg-gray-50 p-2 flex flex-col items-center gap-2">
                                                            {config.pairing_barcode_data_url ? (
                                                                <img src={config.pairing_barcode_data_url} alt="Pairing Barcode" className="w-full max-w-[240px] object-contain" />
                                                            ) : (
                                                                <div className="text-xs text-gray-500">No barcode generated yet.</div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadDataUrl(config.pairing_barcode_data_url, `pairing-${config.id}-barcode.png`)}
                                                                className="text-xs px-3 py-1 border rounded hover:bg-gray-100"
                                                                disabled={!config.pairing_barcode_data_url}
                                                            >
                                                                Download Barcode
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
                </section>
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
                                <div className="text-xs text-gray-500">Sorting: Class (A-Z), Name (A-Z)</div>
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
                            {((session?.assessment_type || 'NAPFA5') === 'IPPT3') ? (
                                <tr className="bg-gray-100 text-left">
                                    <th className="px-3 py-2 border">Student ID</th>
                                    <th className="px-3 py-2 border">Name</th>
                                    <th className="px-3 py-2 border">Class</th>
                                    <th className="px-3 py-2 border">Sit-ups</th>
                                    <th className="px-3 py-2 border">Push-ups</th>
                                    <th className="px-3 py-2 border">2.4km Run (mm:ss)</th>
                                    <th className="px-3 py-2 border w-40">Actions</th>
                                </tr>
                            ) : (
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
                            )}
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
                                    const canRecord = true;
                                        const isCompleted = completedSet.has(s.id);
                                        const isInProgress = inProgressSet.has(s.id);
                                        const statusLeft = isCompleted
                                            ? 'border-l-4 border-l-green-500'
                                            : (isInProgress ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-gray-300');
                                        if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
                                          return [
                                            <tr key={s.id}>
                                              <td className={`px-3 py-2 border align-top ${statusLeft}`}>{normalizeStudentId(s.student_identifier)}</td>
                                              <td className="px-3 py-2 border align-top">{s.name}</td>
                                              <td className="px-3 py-2 border align-top">{s.class || '-'}</td>
                                              <td className="px-3 py-2 border align-top">{row.situps ?? '-'}</td>
                                              <td className="px-3 py-2 border align-top">{row.pushups ?? '-'}</td>
                                              <td className="px-3 py-2 border align-top">{fmtRun(row.run_2400) || '-'}</td>
                                              <td className="px-3 py-2 border align-top">
                                                <ScoreRowActions student={s} canRecord={canRecord} onSaved={async () => { await loadScoresMap(); await loadScoresCount(); }} sessionId={id} isIppt3={isIppt3} />
                                              </td>
                                            </tr>
                                          ];
                                        }
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
                                                    <ScoreRowActions student={s} canRecord={canRecord} onSaved={async () => { await loadScoresMap(); await loadScoresCount(); }} sessionId={id} isIppt3={isIppt3} />
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

function ScoreRowActions({ student, sessionId, canRecord, onSaved, isIppt3 }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button onClick={() => setOpen(true)} disabled={!canRecord} className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm">
                Edit
            </button>
            {open && (
                <div className="fixed inset-0 z-40">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden="true" />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-xl shadow-lg">
                            <div className="px-4 py-3 border-b flex items-center justify-between">
                                <div className="font-medium">Edit Scores - {student.name}</div>
                                <button className="text-gray-500 hover:text-gray-800" aria-label="Close" onClick={() => setOpen(false)}>Close</button>
                            </div>
                            <div className="p-4">
                                <AttemptEditor sessionId={sessionId} studentId={student.id} isIppt3={isIppt3} onSaved={() => { setOpen(false); onSaved && onSaved(); }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

 





















