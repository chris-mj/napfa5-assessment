import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "../components/ToastProvider";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];

export default function Sessions({ user }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [membership, setMembership] = useState(null);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipError, setMembershipError] = useState("");
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        if (err || !data) setMembershipError("Unable to determine school membership.");
        else setMembership(data);
      })
      .finally(() => setMembershipLoading(false));
  }, [user]);

  useEffect(() => {
    if (!membership?.school_id) return;
    setLoading(true);
    supabase
      .from("sessions")
      .select("*")
      .eq("school_id", membership.school_id)
      .order("session_date", { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message || "Failed to load sessions.");
        else setSessions(data || []);
      })
      .finally(() => setLoading(false));
  }, [membership?.school_id]);

  const setStatus = async (sessionId, status) => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .update({ status })
        .eq('id', sessionId)
        .select()
        .single();
      if (error) throw error;
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? data : s)));
      showToast?.(`Session set to ${status}.`, { type: 'success' });
    } catch (err) {
      showToast?.(err.message || 'Failed to update status.', { type: 'error' });
    }
  };

  if (!user) return <div className="p-6">Please login.</div>;
  if (membershipLoading) return <div className="p-6">Loading membership...</div>;
  if (membershipError) return <div className="p-6 text-red-600">{membershipError}</div>;

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Sessions</h1>
          <p className="text-gray-600">Manage NAPFA sessions for your school.</p>
        </div>
        {canManage && (
          <button
            onClick={() => navigate("/sessions")}
            className="self-start md:self-auto bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            New Session
          </button>
        )}
      </header>

      <section>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="border rounded p-4 animate-pulse space-y-3">
                <div className="h-6 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
                <div className="h-8 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-gray-600 flex flex-col items-center justify-center py-10 text-center">
            <img src="/icon.png" alt="No sessions" className="w-12 h-12 mb-3 opacity-80" />
            <p>No sessions found.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => (
              <article key={session.id} className="border rounded p-4 space-y-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-lg" title={session.status || "draft"} aria-label={session.status || "draft"}>
                    {session.status === 'active' ? '🟢' : session.status === 'completed' ? '✅' : '⏳'}
                  </span>
                  <h2 className="text-xl font-semibold text-gray-800 flex-1">{session.title}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded border ${session.status === 'completed' ? 'bg-gray-200 text-gray-700' : session.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>
                    {session.status || "draft"}
                  </span>
                </div>
                <p className="text-sm text-gray-500">
                  Session Date: <span className="font-medium">{new Date(session.session_date).toLocaleDateString()}</span>
                </p>
                {session.created_at && (
                  <p className="text-xs text-gray-400">Created {new Date(session.created_at).toLocaleString()}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {canManage && (
                    <>
                      {session.status === 'draft' && (
                        <button onClick={() => setStatus(session.id, 'active')} className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm">Activate</button>
                      )}
                      {session.status === 'active' && (
                        <button onClick={() => setStatus(session.id, 'completed')} className="px-3 py-1.5 bg-gray-800 text-white rounded hover:bg-gray-900 text-sm">Mark Completed</button>
                      )}
                      {session.status === 'completed' && (
                        <button onClick={() => setStatus(session.id, 'active')} className="px-3 py-1.5 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm">Reopen</button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => navigate(`/sessions/${session.id}`)}
                    className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm"
                  >
                    View
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

