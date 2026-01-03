import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";

export default function Dashboard({ user }) {
  const [memberships, setMemberships] = useState([]);
  const [err, setErr] = useState("");

  // Core overview
  const [todaySessions, setTodaySessions] = useState({ draft: 0, active: 0, completed: 0 });
  const [attemptsToday, setAttemptsToday] = useState(0);
  const [rosterCompletion, setRosterCompletion] = useState({ total: 0, completed: 0, inProgress: 0, notStarted: 0 });

  // Upcoming & Active
  const [upcoming, setUpcoming] = useState([]);
  const [active, setActive] = useState([]);

  // Roles present for this user
  const roleSet = useMemo(() => new Set((memberships || []).map(m => String(m.role || '').toLowerCase())), [memberships]);
  const isOwner = isPlatformOwner(user);
  const isAdmin = roleSet.has('admin') || roleSet.has('superadmin') || isOwner;
  const isTeacher = roleSet.has('score_taker');
  const isViewer = roleSet.has('viewer');

  // Role Workflows tab
  const availableTabs = useMemo(() => {
    const tabs = [];
    if (isTeacher || (!isAdmin && !isOwner && !isViewer)) tabs.push({ id: 'teacher', label: 'Teacher' });
    if (isAdmin) tabs.push({ id: 'admin', label: 'Admin' });
    if (isViewer && !isAdmin && !isOwner) tabs.push({ id: 'viewer', label: 'Viewer' });
    if (isOwner) tabs.push({ id: 'owner', label: 'Owner' });
    return tabs.length ? tabs : [{ id: 'teacher', label: 'Teacher' }];
  }, [isTeacher, isAdmin, isViewer, isOwner]);
  const defaultTab = availableTabs[0]?.id || 'teacher';
  const [wfTab, setWfTab] = useState(defaultTab);
  useEffect(() => { setWfTab(defaultTab) }, [defaultTab]);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      if (!user?.id) return;
      try {
        const { data: mem } = await supabase
          .from('memberships')
          .select('role, school_id, schools!inner(name)')
          .eq('user_id', user.id);
        if (!ignore) setMemberships(mem || []);
      } catch (e) {
        if (!ignore) setErr(e?.message || 'Failed to load memberships');
      }
    };
    load();
    return () => { ignore = true };
  }, [user?.id]);

  useEffect(() => {
    let ignore = false;
    async function loadDashboardData() {
      if (!memberships.length) return;
      const schoolId = memberships[0].school_id; // primary membership for scope
      try {
        // Today window (local day)
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const startISO = start.toISOString();
        const endISO = end.toISOString();

        // Sessions by status for today
        const { data: sessDraft } = await supabase
          .from('sessions')
          .select('id')
          .eq('school_id', schoolId)
          .eq('status', 'draft')
          .gte('session_date', startISO)
          .lt('session_date', endISO);
        const { data: sessActive } = await supabase
          .from('sessions')
          .select('id')
          .eq('school_id', schoolId)
          .eq('status', 'active')
          .gte('session_date', startISO)
          .lt('session_date', endISO);
        const { data: sessCompleted } = await supabase
          .from('sessions')
          .select('id')
          .eq('school_id', schoolId)
          .eq('status', 'completed')
          .gte('session_date', startISO)
          .lt('session_date', endISO);
        if (ignore) return;
        setTodaySessions({
          draft: (sessDraft || []).length,
          active: (sessActive || []).length,
          completed: (sessCompleted || []).length,
        });

        // Attempts recorded today
        const { data: attempts } = await supabase
          .from('scores')
          .select('id, updated_at, session_id, sessions!inner(school_id)')
          .gte('updated_at', startISO)
          .lt('updated_at', endISO);
        const countToday = (attempts || []).filter(r => r.sessions?.school_id === schoolId).length;
        if (ignore) return;
        setAttemptsToday(countToday);

        // Upcoming (next 7 days) and currently active sessions list
        const horizonEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
        const { data: upc } = await supabase
          .from('sessions')
          .select('id,title,session_date,status')
          .eq('school_id', schoolId)
          .gt('session_date', endISO)
          .lt('session_date', horizonEnd)
          .order('session_date', { ascending: true });
        const { data: act } = await supabase
          .from('sessions')
          .select('id,title,session_date,status')
          .eq('school_id', schoolId)
          .eq('status', 'active')
          .order('session_date', { ascending: true });
        if (ignore) return;
        setUpcoming(upc || []);
        setActive(act || []);

        // Simple completion snapshot: last active session roster vs completed
        if ((act || []).length > 0) {
          const sid = act[0].id;
          const { data: rosterRows } = await supabase
            .from('session_roster')
            .select('student_id')
            .eq('session_id', sid);
          const rosterIds = new Set((rosterRows || []).map(r => r.student_id));
          const { data: scoreRows } = await supabase
            .from('scores')
            .select('student_id, situps, shuttle_run, sit_and_reach, pullups, broad_jump')
            .eq('session_id', sid);
          const required = ['situps','shuttle_run','sit_and_reach','pullups','broad_jump'];
          let completed = 0, inProg = 0, notStarted = 0;
          rosterIds.forEach(id => {
            const row = (scoreRows || []).find(x => x.student_id === id);
            if (!row) { notStarted++; return; }
            const nonNull = required.reduce((a,k)=>a+(row[k]==null?0:1),0);
            if (nonNull === 0) notStarted++;
            else if (nonNull === required.length) completed++;
            else inProg++;
          });
          setRosterCompletion({ total: rosterIds.size, completed, inProgress: inProg, notStarted });
        } else {
          setRosterCompletion({ total: 0, completed: 0, inProgress: 0, notStarted: 0 });
        }
      } catch (e) {
        setErr(e?.message || 'Failed to load dashboard data');
      }
    }
    loadDashboardData();
    return () => { ignore = true };
  }, [memberships]);

  const kpi = (label, value) => (
    <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );

  return (
    <div className="bg-[#F9FAFB]">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* Temporary notice */}
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
          Dashboard production is in progress. Please do not click on anything on this page yet.
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="NAPFA 5" className="w-8 h-8" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
            <div className="text-sm text-slate-600">Welcome back{user?.email ? `, ${user.email}` : ''}.</div>
          </div>
        </div>

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
        )}

        {/* Role Workflows (moved to top) */}
        <section>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">Role Workflows</h2>
          {/* Segmented control */}
          <div className="inline-flex rounded-lg bg-gray-100 p-1 text-sm mb-3">
            {availableTabs.map(t => (
              <button
                key={t.id}
                className={(wfTab === t.id ? 'bg-white text-blue-700 shadow border border-gray-200' : 'text-gray-700 hover:text-gray-900') + ' px-3 py-1.5 rounded-md transition-colors'}
                onClick={() => setWfTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Panels */}
          {wfTab === 'teacher' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Run */}
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Run</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>Record scores</div>
                    <Link to="/add-attempt" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
              {/* View */}
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">View</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>View scores</div>
                    <Link to="/view-score" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {wfTab === 'admin' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Plan */}
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Plan</div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                    <div>Manage students & enrollments</div>
                    <Link to="/manage-students" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>Plan NAPFA sessions <span className="ml-1 text-xs text-gray-500">({todaySessions.draft})</span></div>
                        <Link to="/sessions" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Manage</Link>
                    </div>
                    <div className="flex items-center justify-between">
                    <div>Manage users</div>
                    <Link to="/modify-user" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                    </div>
                </div>
              </div>
              {/* Run */}
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Run</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>Active sessions <span className="ml-1 text-xs text-gray-500">({active.length})</span></div>
                    <Link to="/sessions" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">View</Link>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>Score entry</div>
                    <Link to="/add-attempt" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>View scores</div>
                    <Link to="/view-score" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
              {/* Wrap up */}
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Wrap Up</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>Export PFT (all / per class)</div>
                    <Link to="/sessions" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>Review recent exports</div>
                    <Link to="/sessions" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">View</Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {wfTab === 'viewer' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">View</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>View scores</div>
                    <Link to="/view-score" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {wfTab === 'owner' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Plan</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>Manage schools</div>
                    <Link to="/create-school" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Run</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>Global admin</div>
                    <Link to="/admin-global" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Wrap Up</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>Manage users</div>
                    <Link to="/modify-user" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Upcoming & Active */}
        <section>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">Active & Upcoming</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">Active Sessions</div>
                <Link to="/sessions" className="text-sm text-blue-700 hover:underline">Manage</Link>
              </div>
              <ul className="divide-y divide-gray-100">
                {(active || []).slice(0,5).map(s => (
                  <li key={s.id} className="py-2 flex items-center justify-between">
                    <Link to={`/session/${s.id}`} className="text-slate-800 hover:underline">{s.title || 'Untitled'}</Link>
                    <span className="text-xs rounded px-2 py-0.5 bg-green-50 text-green-700 border border-green-200">active</span>
                  </li>
                ))}
                {active.length === 0 && <li className="py-2 text-sm text-gray-500">No active sessions</li>}
              </ul>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">Upcoming (next 7 days)</div>
                <Link to="/sessions" className="text-sm text-blue-700 hover:underline">View all</Link>
              </div>
              <ul className="divide-y divide-gray-100">
                {(upcoming || []).slice(0,5).map(s => (
                  <li key={s.id} className="py-2 flex items-center justify-between">
                    <span className="text-slate-800">{s.title || 'Untitled'}</span>
                    <span className="text-xs text-gray-500">{(() => { try { const d=new Date(s.session_date); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}/${mm}/${yyyy}` } catch { return '' } })()}</span>
                  </li>
                ))}
                {upcoming.length === 0 && <li className="py-2 text-sm text-gray-500">No upcoming sessions</li>}
              </ul>
            </div>
          </div>
        </section>

        {/* Insights */}
        <section>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">Insights</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-sm text-gray-500 mb-1">Award mix (last 30 days)</div>
              <div className="text-sm text-gray-400">Coming soon</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-sm text-gray-500 mb-1">Station averages</div>
              <div className="text-sm text-gray-400">Coming soon</div>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
              <div className="text-sm text-gray-500 mb-1">Throughput</div>
              <div className="text-sm text-gray-400">Coming soon</div>
            </div>
          </div>
        </section>

        

        {/* What's new */}
        <section>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">What’s new</h2>
          <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-100">
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li>Dual-list roster with filters and pagination.</li>
              <li>Improved PFT export (template header rows, attendance/date logic, per-class files).</li>
              <li>Profile cards PDF with footer bands and class page breaks.</li>
              <li>Live station validation and auto-select session when only one.</li>
              <li>Homepage redesign with premium hero and animations.</li>
            </ul>
          </div>
        </section>

        
      </div>
    </div>
  );
}
