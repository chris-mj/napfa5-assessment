import { useEffect, useMemo, useState } from "react";
import AttemptEditor from "../components/AttemptEditor";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import RosterUpload from "../components/SessionRosterUpload";
import RosterSelect from "../components/SessionRosterSelect";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];

export default function SessionDetail({ user }) {
    const { id } = useParams();
    const navigate = useNavigate();

    const [membership, setMembership] = useState(null);
    const [membershipLoading, setMembershipLoading] = useState(true);
    const [membershipError, setMembershipError] = useState("");

    const [session, setSession] = useState(null);
    const [roster, setRoster] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editMode, setEditMode] = useState(false);
    const [formState, setFormState] = useState({ title: "", session_date: "" });
    const [formSubmitting, setFormSubmitting] = useState(false);
    const [flash, setFlash] = useState("");

    const canManage = useMemo(() => ROLE_CAN_MANAGE.includes(membership?.role), [membership]);

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
                    setFormState({ title: data.title, session_date: data.session_date });
                    setError("");
                }
            })
            .finally(() => setLoading(false));
    }, [membership?.school_id, id]);

    useEffect(() => {
        if (!id) return;
        loadRoster();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

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

    useEffect(() => {
        if (!flash) return;
        const timer = setTimeout(() => setFlash(""), 3500);
        return () => clearTimeout(timer);
    }, [flash]);

    const handleEditToggle = () => {
        if (!session) return;
        setFormState({ title: session.title, session_date: session.session_date });
        setEditMode((prev) => !prev);
        setFlash("");
    };

    const handleUpdate = async (event) => {
        event.preventDefault();
        if (!session) return;
        setFormSubmitting(true);
        try {
            const { data, error: err } = await supabase
                .from("sessions")
                .update({ title: formState.title, session_date: formState.session_date })
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
            <header className="space-y-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-semibold text-gray-800">{session.title}</h1>
                    <span className={`text-xs px-2 py-1 rounded border ${session.status === 'completed' ? 'bg-gray-200 text-gray-700' : session.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>
                        {session.status}
                    </span>
                </div>
                <p className="text-gray-600">
                    Session date: <span className="font-medium">{new Date(session.session_date).toLocaleDateString()}</span>
                </p>
                {session.created_at && (
                    <p className="text-sm text-gray-400">Created {new Date(session.created_at).toLocaleString()}</p>
                )}
            </header>

            {flash && <div className="text-sm text-blue-600">{flash}</div>}

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
                            {session.status === 'draft' && (
                                <button onClick={async ()=>{
                                    const { data, error: err } = await supabase.from('sessions').update({ status: 'active' }).eq('id', session.id).select().single();
                                    if (!err) { setSession(data); setFlash('Session activated.'); }
                                }} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">Activate</button>
                            )}
                            {session.status === 'active' && (
                                <button onClick={async ()=>{
                                    const { data, error: err } = await supabase.from('sessions').update({ status: 'completed' }).eq('id', session.id).select().single();
                                    if (!err) { setSession(data); setFlash('Session completed.'); }
                                }} className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900">Mark Completed</button>
                            )}
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

            <section className="space-y-3">
                <h2 className="text-xl font-semibold">Roster</h2>
                {canManage && (
                    <div className="space-y-3">
                        <RosterUpload sessionId={id} schoolId={membership?.school_id} onDone={loadRoster} />
                        <RosterSelect sessionId={id} schoolId={membership?.school_id} onDone={loadRoster} />
                    </div>
                )}
                <div className="border rounded">
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
                                onSaved={loadRoster}
                            />
                        ))}
                        </tbody>
                    </table>
                </div>
            </section>
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
