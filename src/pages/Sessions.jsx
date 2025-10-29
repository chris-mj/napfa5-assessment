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
  const [creating, setCreating] = useState(false);

  const formatDDMMYYYY = (isoDate) => {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

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
        if (err || !data) setMembershipError("Unable to determine school membership.")
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

  const handleCreateSession = async () => {
    if (!membership?.school_id) { showToast?.('error', 'No school context.'); return; }
    setCreating(true);
    try {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      // DB expects ISO date; display title uses DD/MM/YYYY
      const dateISO = `${yyyy}-${mm}-${dd}`;
      const dateDisplay = `${dd}/${mm}/${yyyy}`;
      const title = `NAPFA Session ${dateDisplay}`;
      // Avoid created_by to prevent PostgREST schema cache errors
      const payload = { school_id: membership.school_id, title, session_date: dateISO, status: 'draft' };
      const { data, error: err } = await supabase
        .from('sessions')
        .insert(payload)
        .select()
        .single();
      if (err) throw err;
      // optimistic update list
      setSessions(prev => [data, ...prev]);
      navigate(`/sessions/${data.id}`, { state: { edit: true } });
    } catch (e) {
      showToast?.('error', e.message || 'Failed to create session.');
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (sessionId, status) => {
    try {
      const current = sessions.find((s) => s.id === sessionId);
      if (status === 'completed' && current?.status !== 'completed') {
        const ok = window.confirm('Mark this session as completed? Scores and roster edits will be locked.');
        if (!ok) return;
      }
      const { data, error } = await supabase
        .from('sessions')
        .update({ status })
        .eq('id', sessionId)
        .select()
        .single();
      if (error) throw error;
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? data : s)));
      showToast?.('success', `Session set to ${status}.`);
    } catch (err) {
      showToast?.('error', err.message || 'Failed to update status.');
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
            onClick={handleCreateSession}
            disabled={creating}
            className="self-start md:self-auto bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'New Session'}
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
              <article key={session.id} className="border rounded p-4 space-y-3 shadow-sm transition-all duration-200 hover:shadow">
                <div className="flex items-center gap-2">
                  <span className="text-lg" title={session.status || "draft"} aria-label={session.status || "draft"}>
                    {session.status === 'active' ? '🟢' : session.status === 'completed' ? '✅' : '⏳'}
                  </span>
                  <h2 className="text-xl font-semibold text-gray-800 flex-1">{session.title}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded border ${session.status === 'completed' ? 'bg-gray-200 text-gray-700' : session.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>
                    {session.status || "draft"}
                  </span>
                  {canManage && (
                    <label className="ml-2 text-xs text-gray-600 flex items-center gap-1">
                      Status
                      <select
                        className="text-xs border rounded px-2 py-1 bg-white"
                        value={session.status || 'draft'}
                        onChange={(e) => setStatus(session.id, e.target.value)}
                      >
                        <option value="draft">draft</option>
                        <option value="active">active</option>
                        <option value="completed">completed</option>
                      </select>
                    </label>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  Session Date: <span className="font-medium">{formatDDMMYYYY(session.session_date)}</span>
                </p>
                {session.created_at && (
                  <p className="text-xs text-gray-400">Created {new Date(session.created_at).toLocaleString()}</p>
                )}
                <div className="flex flex-wrap gap-2">
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
