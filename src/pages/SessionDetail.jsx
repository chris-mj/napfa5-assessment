import { useEffect, useMemo, useState } from "react";
import AttemptEditor from "../components/AttemptEditor";
import { jsPDF } from "jspdf";
import { drawBarcode } from "../utils/barcode";
import { drawQrDataUrl } from "../utils/qrcode";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";
import RosterDualList from "../components/RosterDualList";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];

export default function SessionDetail({ user }) {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [membership, setMembership] = useState(null);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

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
            .select("student_id, students!inner(id, student_identifier, name)")
            .eq("session_id", id)
            .order("student_id", { ascending: true });
        if (err) return;
        const list = (data || []).map((r) => ({ id: r.students.id, student_identifier: r.students.student_identifier, name: r.students.name }));
        setRoster(list);
    };

    const loadScoresCount = async () => {
        // Pull all score rows for this session and derive status counts from non-null metrics
        const { data: rows, error: err } = await supabase
            .from('scores')
            .select('student_id, situps, shuttle_run, sit_and_reach, pullups, run_2400, broad_jump')
            .eq('session_id', id);
        if (err) return;
        // For completion, run_2400 is not required
        const requiredMetrics = ['situps','shuttle_run','sit_and_reach','pullups','broad_jump'];
        const byStudent = new Map((rows || []).map(r => [r.student_id, r]));
        const scored = new Set();
        const inprog = new Set();
        const completed = new Set();
        (roster || []).forEach(s => {
            const row = byStudent.get(s.id);
            if (!row) return; // no row yet => not started
            const nonNullCount = requiredMetrics.reduce((acc, k) => acc + (row[k] == null ? 0 : 1), 0);
            if (nonNullCount > 0) scored.add(s.id);
            if (nonNullCount === requiredMetrics.length) completed.add(s.id);
            else if (nonNullCount > 0) inprog.add(s.id);
        });
        setScoredSet(scored);
        setInProgressSet(inprog);
        setCompletedSet(completed);
        setScoresCount(completed.size);
    };

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

    
    const exportResults = async () => {
        try {
            const { data: rows, error } = await supabase
                .rpc('export_session_scores_pft', { p_session_id: id });
            if (error) throw error;
            const headers = [
                'Sl.No','Name','ID','Class','Gender','DOB','Attendance',
                'Sit-ups','Standing Broad Jump (cm)','Sit & Reach (cm)','Pull-ups','Shuttle Run (sec)','1.6/2.4 Km Run MMSS','PFT Test Date'
            ];
            const csvRows = [headers.join(',')];
            (rows || []).forEach(r => {
                const ordered = [
                    r["Sl.No"], r["Name"], r["ID"], r["Class"], r["Gender"], r["DOB"], r["Attendance"],
                    r["Sit-ups"], r["Standing Broad Jump (cm)"], r["Sit & Reach (cm)"], r["Pull-ups"], r["Shuttle Run (sec)"], r["1.6/2.4 Km Run MMSS"], r["PFT Test Date"]
                ];
                csvRows.push(ordered.map(v => (v == null ? '' : (typeof v === 'string' ? '"' + v.replace(/"/g,'""') + '"' : v))).join(','));
            });
            const blob = new Blob(["\uFEFF" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `session_${id}_results_pft.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            setFlash(err.message || 'Failed to export results.');
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

            for (let i = 0; i < list.length; i++) {
                const s = list[i];
                const pageIndex = Math.floor(i / (cols * rows));
                const idxInPage = i % (cols * rows);
                const col = idxInPage % cols;
                const row = Math.floor(idxInPage / cols);
                if (i > 0 && idxInPage === 0) doc.addPage();
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
                drawBarcode(bcCanvas, s.student_identifier, { format: 'CODE128', width: 2, height: targetBcHpx, margin: 24 });
                // If generated width is smaller/larger than target, it's OK; PDF scales the image retaining resolution
                const bcUrl = bcCanvas.toDataURL('image/png');
                const qrUrl = await drawQrDataUrl(s.student_identifier, targetQrPx, 'M', 1);

                // Card border
                doc.setDrawColor(180);
                doc.setLineWidth(0.3);
                doc.rect(x0 + 2, y0 + 2, cellW - 4, cellH - 4);

                // Text
                doc.setFontSize(14);
                doc.text(String(s.student_identifier), x0 + 6, y0 + 12);
                doc.setFontSize(12);
                doc.text(s.name || '', x0 + 6, y0 + 20);
                doc.text((s.class || ''), x0 + 6, y0 + 26);

                // Images
                // QR on right
                doc.addImage(qrUrl, 'PNG', x0 + cellW - qrSize - 6, y0 + 8, qrSize, qrSize);
                // Barcode bottom spans width minus QR area
                const bcW = cellW - qrSize - 12;
                const bcH = 14;
                doc.addImage(bcUrl, 'PNG', x0 + 6, y0 + cellH - bcH - 8, bcW, bcH);
            }

            doc.save(`session_${id}_profile_cards.pdf`);
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
                                <div className="h-2 w-full bg-gray-200 rounded overflow-hidden">
                                    <div className="h-2 bg-gray-400" style={{ width: `${pct(notStarted)}%` }} />
                                    <div className="h-2 bg-amber-400" style={{ width: `${pct(inProgress)}%` }} />
                                    <div className="h-2 bg-green-500" style={{ width: `${pct(completed)}%` }} />
                                </div>
                                <div className="flex justify-between text-[11px] text-gray-600">
                                    <span>Not started {pct(notStarted)}%</span>
                                    <span>In progress {pct(inProgress)}%</span>
                                    <span>Completed {pct(completed)}%</span>
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* Tabs moved out of sticky header */}
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

            {/*/!* Tabs *!/*/}
            {/*<nav className="flex items-center justify-start">*/}
            {/*    <div role="tablist" aria-label="Session sections" className="inline-flex rounded-lg bg-gray-100 p-1 text-sm">*/}
            {/*        <button*/}
            {/*            role="tab"*/}
            {/*            aria-selected={activeTab === 'roster'}*/}
            {/*            className={(activeTab === 'roster'*/}
            {/*                ? 'bg-white text-blue-700 shadow border border-gray-200'*/}
            {/*                : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}*/}
            {/*            onClick={() => setActiveTab('roster')}*/}
            {/*        >*/}
            {/*            Roster*/}
            {/*        </button>*/}
            {/*        <button*/}
            {/*            role="tab"*/}
            {/*            aria-selected={activeTab === 'scores'}*/}
            {/*            className={(activeTab === 'scores'*/}
            {/*                ? 'bg-white text-blue-700 shadow border border-gray-200'*/}
            {/*                : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}*/}
            {/*            onClick={() => setActiveTab('scores')}*/}
            {/*        >*/}
            {/*            Scores*/}
            {/*        </button>*/}
            {/*    </div>*/}
            {/*</nav>*/}

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
                        <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium flex items-center justify-between">
                            <span>Scores</span>
                            {canManage && (
                                <button
                                    onClick={exportResults}
                                    className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                >
                                    Export Results
                                </button>
                            )}
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-100 text-left">
                                    <th className="px-3 py-2 border">Student ID</th>
                                    <th className="px-3 py-2 border">Name</th>
                                    <th className="px-3 py-2 border w-48">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                            {roster.length === 0 ? (
                                <tr><td colSpan="3" className="px-3 py-4 text-center text-gray-500">No students in this session yet.</td></tr>
                            ) : roster.map((s) => (
                                <RosterRow
                                    key={s.id}
                                    s={s}
                                    sessionId={id}
                                    canRecord={session.status === 'active' && ['admin','superadmin','score_taker'].includes(membership?.role)}
                                    onSaved={() => { loadRoster(); loadScoresCount(); }}
                                />
                            ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
}

function RosterRow({ s, sessionId, canRecord, onSaved }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <tr>
                <td className="px-3 py-2 border">{s.student_identifier}</td>
                <td className="px-3 py-2 border">{s.name}</td>
                <td className="px-3 py-2 border">
                    <button onClick={() => canRecord && setOpen(v => !v)} disabled={!canRecord} className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm">
                        
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










