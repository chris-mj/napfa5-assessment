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
  const [typeUpdating, setTypeUpdating] = useState(null);
  // scroll behavior: default

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
      const payload = { school_id: membership.school_id, title, session_date: dateISO, status: 'draft', assessment_type: 'NAPFA5' };
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

  const countScoresForSession = async (sessionId) => {
    const [s1, s2] = await Promise.all([
      supabase.from('scores').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
      supabase.from('ippt3_scores').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
    ]);
    const c1 = typeof s1?.count === 'number' ? s1.count : 0;
    const c2 = typeof s2?.count === 'number' ? s2.count : 0;
    return c1 + c2;
  };

  const setAssessmentType = async (session, nextType) => {
    if (!session || !nextType || nextType === (session.assessment_type || 'NAPFA5')) return;
    try {
      setTypeUpdating(session.id);
      const total = await countScoresForSession(session.id);
      if (total > 0) { showToast?.('error', 'Cannot change assessment type after scores are recorded.'); return; }
      const { data, error } = await supabase
        .from('sessions')
        .update({ assessment_type: nextType })
        .eq('id', session.id)
        .select()
        .single();
      if (error) throw error;
      setSessions(prev => prev.map(s => (s.id === session.id ? data : s)));
      showToast?.('success', `Assessment type set to ${nextType === 'IPPT3' ? 'IPPT-3' : 'NAPFA-5'}.`);
    } catch (e) {
      showToast?.('error', e.message || 'Failed to update assessment type.');
    } finally {
      setTypeUpdating(null);
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
                  {(() => {
                    const st = session.status || 'draft';
                    if (st === 'active') {
                      return (
                        <svg viewBox="0 0 20 20" className="w-5 h-5 text-green-600" aria-hidden="true">
                          <polygon points="6,4 16,10 6,16" fill="currentColor" />
                        </svg>
                      );
                    } else if (st === 'completed') {
                      return (
                        <svg viewBox="0 0 24 24" className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      );
                    }
                    return (
                      <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber-500" aria-hidden="true">
                        <path fill="currentColor" d="M6 2h12v2l-5 5 5 5v2H6v-2l5-5-5-5V2z" />
                      </svg>
                    );
                  })()}
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
                <div className="text-xs text-gray-700">
                  <span className="text-gray-500 mr-2">Assessment Type:</span>
                  {canManage ? (
                    <select
                      className="text-xs border rounded px-2 py-1 bg-white"
                      value={session.assessment_type || 'NAPFA5'}
                      disabled={typeUpdating === session.id}
                      onChange={(e)=> setAssessmentType(session, e.target.value)}
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

