import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "../components/ToastProvider";

const PAGE_SIZE_OPTIONS = [6, 9, 12];

const ROLE_CAN_MANAGE = ["superadmin", "admin"];

export default function Sessions({ user }) {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [membership, setMembership] = useState(null);
    const [membershipLoading, setMembershipLoading] = useState(true);
    const [membershipError, setMembershipError] = useState("");

    const [sessions, setSessions] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState("create"); // create | edit
    const [formState, setFormState] = useState({ title: "", session_date: "" });
    const [formSubmitting, setFormSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const [activeSessionId, setActiveSessionId] = useState(null);

    const canManage = useMemo(() => {
        const role = membership?.role;
        return ROLE_CAN_MANAGE.includes(role);
    }, [membership]);

    const sessionMatchesFilters = (session) => {
        const term = debouncedSearch.toLowerCase();
        if (term && !session.title.toLowerCase().includes(term)) return false;
        if (startDate && session.session_date < startDate) return false;
        if (endDate && session.session_date > endDate) return false;
        return true;
    };

    const sortSessionsByDate = (list) =>
        [...list].sort((a, b) => {
            const diff = new Date(a.session_date) - new Date(b.session_date);
            if (diff === 0) return a.title.localeCompare(b.title);
            return diff;
        });

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

    // debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search.trim());
            setPage(1);
        }, 350);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (!membership?.school_id) return;
        fetchSessions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [membership?.school_id, debouncedSearch, startDate, endDate, page, pageSize]);

    const fetchSessions = async () => {
        if (!membership?.school_id) return;
        setLoading(true);
        setError("");
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
            .from("sessions")
            .select("*", { count: "exact" })
            .eq("school_id", membership.school_id);

        if (debouncedSearch) {
            query = query.ilike("title", `%${debouncedSearch}%`);
        }
        if (startDate) {
            query = query.gte("session_date", startDate);
        }
        if (endDate) {
            query = query.lte("session_date", endDate);
        }

        const { data, count, error: err } = await query
            .order("session_date", { ascending: true })
            .range(from, to);

        if (err) {
            setError(err.message || "Failed to load sessions.");
            setSessions([]);
            setTotalCount(0);
        } else {
            setSessions(data || []);
            setTotalCount(count || 0);
        }
        setLoading(false);
    };

    const resetForm = () => {
        setFormState({
            title: "",
            session_date: new Date().toISOString().slice(0, 10),
        });
        setFormError("");
        setActiveSessionId(null);
    };

    const openCreateModal = () => {
        resetForm();
        setModalMode("create");
        setModalOpen(true);
    };

    const openEditModal = (session) => {
        setFormState({
            title: session.title,
            session_date: session.session_date,
        });
        setActiveSessionId(session.id);
        setModalMode("edit");
        setFormError("");
        setModalOpen(true);
    };

    const submitForm = async (event) => {
        event.preventDefault();
        if (!membership?.school_id) return;

        if (!formState.title || !formState.session_date) {
            setFormError("Please fill out both title and session date.");
            return;
        }

        setFormSubmitting(true);
        setFormError("");

        try {
            if (modalMode === "create") {
                const { data: inserted, error: err } = await supabase
                    .from("sessions")
                    .insert({
                        school_id: membership.school_id,
                        title: formState.title,
                        session_date: formState.session_date,
                    })
                    .select()
                    .single();
                if (err) throw err;

                if (sessionMatchesFilters(inserted)) {
                    setSessions((prev) => {
                        if (page !== 1) return prev;
                        const updated = sortSessionsByDate([inserted, ...prev]);
                        return updated.slice(0, pageSize);
                    });
                }
                setTotalCount((prev) => prev + 1);
                showToast("success", "Session created.");
            } else if (modalMode === "edit" && activeSessionId) {
                const { data: updated, error: err } = await supabase
                    .from("sessions")
                    .update({
                        title: formState.title,
                        session_date: formState.session_date,
                    })
                    .eq("id", activeSessionId)
                    .select()
                    .single();
                if (err) throw err;

                const matches = sessionMatchesFilters(updated);
                setSessions((prev) => {
                    const index = prev.findIndex((s) => s.id === updated.id);
                    if (index === -1) {
                        if (matches && page === 1) {
                            const updatedList = sortSessionsByDate([...prev, updated]);
                            return updatedList.slice(0, pageSize);
                        }
                        return prev;
                    }

                    const updatedList = [...prev];
                    if (matches) {
                        updatedList[index] = updated;
                    } else {
                        updatedList.splice(index, 1);
                    }
                    return sortSessionsByDate(updatedList);
                });
                showToast("success", "Session updated.");
            }
            setModalOpen(false);
            await fetchSessions();
        } catch (err) {
            setFormError(err.message || "Unable to save session.");
            showToast("error", err.message || "Unable to save session.");
        } finally {
            setFormSubmitting(false);
        }
    };

    const handleDelete = async (sessionId) => {
        const confirm = window.confirm("Delete this session? This action cannot be undone.");
        if (!confirm) return;
        const { error: err } = await supabase.from("sessions").delete().eq("id", sessionId);
        if (err) {
            showToast("error", err.message || "Failed to delete session.");
            return;
        }

        const shouldGoPrevPage = sessions.length === 1 && page > 1;
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        setTotalCount((prev) => Math.max(prev - 1, 0));
        showToast("success", "Session deleted.");

        if (shouldGoPrevPage) {
            setPage((prev) => Math.max(prev - 1, 1));
        } else {
            await fetchSessions();
        }
    };

    const totalPages = Math.ceil(totalCount / pageSize) || 1;

    if (!user) {
        return <div className="p-6">Please login.</div>;
    }

    if (membershipLoading) {
        return <div className="p-6">Loading membership…</div>;
    }

    if (membershipError || !membership?.school_id) {
        return <div className="p-6 text-red-600">{membershipError || "Access denied."}</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold">Sessions</h1>
                    <p className="text-gray-600">
                        Manage NAPFA sessions for your school. Use the filters to find upcoming or past
                        sessions quickly.
                    </p>
                </div>
                {canManage && (
                    <button
                        onClick={openCreateModal}
                        className="self-start md:self-auto bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                    >
                        New Session
                    </button>
                )}
            </header>

            <section className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
                <div className="flex-1">
                    <label className="block text-sm text-gray-600 mb-1">Search</label>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by session title…"
                        className="w-full border rounded p-2"
                    />
                </div>
                <div>
                    <label className="block text-sm text-gray-600 mb-1">From</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                            setStartDate(e.target.value);
                            setPage(1);
                        }}
                        className="border rounded p-2"
                    />
                </div>
                <div>
                    <label className="block text-sm text-gray-600 mb-1">To</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                            setEndDate(e.target.value);
                            setPage(1);
                        }}
                        className="border rounded p-2"
                    />
                </div>
                <button
                    onClick={() => {
                        setSearch("");
                        setStartDate("");
                        setEndDate("");
                        setPage(1);
                    }}
                    className="mt-4 md:mt-0 border px-4 py-2 rounded hover:bg-gray-100"
                >
                    Clear Filters
                </button>
            </section>

            {error && <div className="text-red-600 text-sm">{error}</div>}

            <section>
                {loading ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: pageSize }).map((_, idx) => (
                            <div key={idx} className="border rounded p-4 animate-pulse space-y-3">
                                <div className="h-6 bg-gray-200 rounded" />
                                <div className="h-4 bg-gray-200 rounded w-3/4" />
                                <div className="h-4 bg-gray-200 rounded w-1/2" />
                                <div className="h-8 bg-gray-200 rounded" />
                            </div>
                        ))}
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="text-gray-600">No sessions found.</div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {sessions.map((session) => (
                            <article key={session.id} className="border rounded p-4 space-y-3 shadow-sm">
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-800">{session.title}</h2>
                                    <p className="text-sm text-gray-500">
                                        Session Date:{" "}
                                        <span className="font-medium">
                                            {new Date(session.session_date).toLocaleDateString()}
                                        </span>
                                    </p>
                                    {session.created_at && (
                                        <p className="text-xs text-gray-400">
                                            Created {new Date(session.created_at).toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => navigate(`/sessions/${session.id}`)}
                                        className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm"
                                    >
                                        View
                                    </button>
                                    {canManage && (
                                        <>
                                            <button
                                                onClick={() => openEditModal(session)}
                                                className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDelete(session.id)}
                                                className="px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50 text-sm"
                                            >
                                                Delete
                                            </button>
                                        </>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <footer className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Per page:</span>
                    <select
                        value={pageSize}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                        }}
                        className="border rounded p-1"
                    >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </select>
                    <span className="text-sm text-gray-500">
                        Showing {(page - 1) * pageSize + 1}-
                        {Math.min(page * pageSize, totalCount)} of {totalCount}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                        disabled={page === 1}
                        className="px-3 py-1 border rounded disabled:opacity-50"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-gray-600">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                        disabled={page >= totalPages}
                        className="px-3 py-1 border rounded disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            </footer>

            {modalOpen && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                    <div className="bg-white rounded shadow-lg w-full max-w-md p-6 space-y-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-xl font-semibold">
                                    {modalMode === "create" ? "Create Session" : "Edit Session"}
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Provide a session title and date to {modalMode === "create" ? "create" : "update"} the
                                    assessment session.
                                </p>
                            </div>
                            <button
                                onClick={() => setModalOpen(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                ×
                            </button>
                        </div>

                        <form className="space-y-4" onSubmit={submitForm}>
                            <div>
                                <label className="block text-sm mb-1">Title</label>
                                <input
                                    value={formState.title}
                                    onChange={(e) =>
                                        setFormState((prev) => ({ ...prev, title: e.target.value }))
                                    }
                                    className="w-full border rounded p-2"
                                    placeholder="e.g. Sec 3 Combined Session"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Session Date</label>
                                <input
                                    type="date"
                                    value={formState.session_date}
                                    onChange={(e) =>
                                        setFormState((prev) => ({ ...prev, session_date: e.target.value }))
                                    }
                                    className="w-full border rounded p-2"
                                    required
                                />
                            </div>

                            {formError && <p className="text-sm text-red-600">{formError}</p>}

                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
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
                    </div>
                </div>
            )}
        </div>
    );
}
