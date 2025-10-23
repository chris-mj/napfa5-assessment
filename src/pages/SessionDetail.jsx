import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];

export default function SessionDetail({ user }) {
    const { id } = useParams();
    const navigate = useNavigate();

    const [membership, setMembership] = useState(null);
    const [membershipLoading, setMembershipLoading] = useState(true);
    const [membershipError, setMembershipError] = useState("");

    const [session, setSession] = useState(null);
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
                <h1 className="text-3xl font-semibold text-gray-800">{session.title}</h1>
                <p className="text-gray-600">
                    Session date: <span className="font-medium">{new Date(session.session_date).toLocaleDateString()}</span>
                </p>
                {session.created_at && (
                    <p className="text-sm text-gray-400">Created {new Date(session.created_at).toLocaleString()}</p>
                )}
            </header>

            {flash && <div className="text-sm text-blue-600">{flash}</div>}

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
        </div>
    );
}
