import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";

export default function Audit({ user }) {
  const [membership, setMembership] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [entityType, setEntityType] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedSchool, setSelectedSchool] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    const load = async () => {
      const { data, error: err } = await supabase
        .from('memberships')
        .select('school_id, role, schools:schools!inner(id,name)')
        .eq('user_id', user.id);
      if (err) setError(err.message);
      setMemberships(data || []);
      setMembership((data||[])[0] || null);
    };
    load();
  }, [user?.id]);

  const loadEvents = async () => {
    const owner = isPlatformOwner(user);
    const validUuid = (v) => typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v);
    const schoolFilter = owner ? (selectedSchool || null) : (membership?.school_id || null);
    setLoading(true);
    setError("");
    try {
      // public view over audit.audit_events (PostgREST exposes only public/graphql_public)
      let q = supabase.from('audit_events_readable')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (schoolFilter) {
        if (!validUuid(schoolFilter)) {
          setEvents([]);
          setError('No valid school context for audit.');
          setLoading(false);
          return;
        }
        q = q.eq('school_id', schoolFilter);
      } else if (!owner) {
        // Non-owner must have a school context
        setEvents([]);
        setError('No school membership found for audit.');
        setLoading(false);
        return;
      }
      if (entityType) q = q.eq('entity_type', entityType);
      const { data, error: err } = await q;
      if (err) throw err;
      setEvents(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEvents(); /* eslint-disable-next-line */ }, [membership?.school_id, selectedSchool, entityType]);
  useEffect(() => { setPage(1); }, [entityType, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return (events || []).filter(ev => {
      const fields = [
        ev.entity_type,
        ev.action,
        ev.origin,
        ev.entity_id,
        ev.actor_email,
        ev.actor_name,
        ev.school_name,
        ev.session_title,
        ev.student_identifier,
        ev.student_name,
        JSON.stringify(ev.details||{}),
        JSON.stringify(ev.diff||{})
      ];
      return fields.some(x => String(x||'').toLowerCase().includes(q));
    });
  }, [events, query]);

  const owner = isPlatformOwner(user);
  const schoolOptions = useMemo(() => {
    const opts = (memberships || []).map(m => ({ id: m.school_id, name: m.schools?.name || m.school_id }));
    // Deduplicate
    const map = new Map();
    opts.forEach(o => { if (!map.has(o.id)) map.set(o.id, o.name) });
    return Array.from(map.entries()).map(([id,name]) => ({ id, name }));
  }, [memberships]);

  const paged = useMemo(() => {
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const cur = Math.min(page, totalPages);
    const start = (cur - 1) * pageSize;
    return { cur, totalPages, total, items: filtered.slice(start, start + pageSize) };
  }, [filtered, page, pageSize]);

  const trunc = (s) => {
    if (!s) return '-';
    const str = String(s);
    return str.length > 12 ? `${str.slice(0,6)}…${str.slice(-4)}` : str;
  };

  const ddmmyyyy = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const renderEntity = (ev) => {
    const t = String(ev.entity_type||'');
    if (['scores','session_roster','students','enrollments'].includes(t)) {
      const who = ev.student_identifier ? `${ev.student_identifier}${ev.student_name? ' — '+ev.student_name:''}` : trunc(ev.entity_id);
      return `Student: ${who}`;
    }
    if (t === 'sessions') return `Session: ${ev.session_title || trunc(ev.entity_id)}`;
    if (t === 'export_pft') return 'PFT Export';
    if (t === 'profile_cards') return 'Profile Cards';
    if (t === 'import_students') return 'Import Students';
    return trunc(ev.entity_id);
  };

  const renderDetails = (ev) => {
    const d = ev.details || {};
    const t = String(ev.entity_type||'');
    const chips = [];
    if (t === 'export_pft') {
      if (d.mode) chips.push(`mode: ${d.mode}`);
      if (d.class) chips.push(`class: ${d.class}`);
      if (d.rows!=null) chips.push(`rows: ${d.rows}`);
      if (d.file) chips.push(d.file);
    } else if (t === 'profile_cards') {
      if (d.count!=null) chips.push(`count: ${d.count}`);
      if (d.file) chips.push(d.file);
    } else if (t === 'import_students') {
      ['created','updated','exists','failed','total'].forEach(k => { if (d[k]!=null) chips.push(`${k}: ${d[k]}`) });
    } else {
      const s = JSON.stringify(d);
      if (s && s !== '{}') chips.push(s);
    }
    return (
      <div className="flex flex-wrap gap-1">
        {chips.map((c,i)=>(<span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 border text-xs text-gray-700">{c}</span>))}
      </div>
    );
  };

  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Audit</h1>
          <p className="text-sm text-gray-600">Recent audit events for your school. Limited to the latest 100.</p>
        </header>

        <section className="bg-white border rounded-lg p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-gray-600">Filters</div>
            {owner && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">School</label>
                <select className="text-sm border rounded px-2 py-1 bg-white" value={selectedSchool} onChange={e => { setSelectedSchool(e.target.value); setPage(1); }}>
                  <option value="">All</option>
                  {schoolOptions.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </div>
            )}
            <select className="text-sm border rounded px-2 py-1 bg-white" value={entityType} onChange={e => setEntityType(e.target.value)}>
              <option value="">All types</option>
              <option value="scores">scores</option>
              <option value="session_roster">session_roster</option>
              <option value="sessions">sessions</option>
              <option value="enrollments">enrollments</option>
              <option value="memberships">memberships</option>
              <option value="export_pft">export_pft</option>
              <option value="profile_cards">profile_cards</option>
              <option value="import_students">import_students</option>
            </select>
            <input className="text-sm border rounded px-2 py-1 bg-white" placeholder="Search text" value={query} onChange={e => setQuery(e.target.value)} />
            <button onClick={loadEvents} className="text-sm px-3 py-1.5 border rounded bg-white hover:bg-gray-50">Refresh</button>
          </div>
        </section>

        {error && (<div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{error}</div>)}

        <section className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2 border">Time</th>
                {owner && !selectedSchool && (<th className="px-3 py-2 border">School</th>)}
                <th className="px-3 py-2 border">Actor</th>
                <th className="px-3 py-2 border">Type</th>
                <th className="px-3 py-2 border">Action</th>
                <th className="px-3 py-2 border">Origin</th>
                <th className="px-3 py-2 border">Entity</th>
                <th className="px-3 py-2 border">Session</th>
                <th className="px-3 py-2 border">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="8" className="px-3 py-6 text-center text-gray-500">No events</td></tr>
              ) : (
                paged.items.map(ev => (
                  <tr key={ev.id}>
                    <td className="px-3 py-2 border whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</td>
                    {owner && !selectedSchool && (<td className="px-3 py-2 border">{ev.school_name || (schoolOptions.find(s => s.id === ev.school_id)?.name) || trunc(ev.school_id)}</td>)}
                    <td className="px-3 py-2 border">{ev.actor_email || ev.actor_name || trunc(ev.actor_user_id)}</td>
                    <td className="px-3 py-2 border">{ev.entity_type}</td>
                    <td className="px-3 py-2 border">{ev.action}</td>
                    <td className="px-3 py-2 border">{ev.origin}</td>
                    <td className="px-3 py-2 border">{renderEntity(ev)}</td>
                    <td className="px-3 py-2 border">
                      {ev.session_id ? (
                        <a href={`/session/${ev.session_id}#scores`} className="text-blue-700 underline">
                          {ev.session_title || trunc(ev.session_id)}{ev.session_date ? ` — ${ddmmyyyy(ev.session_date)}` : ''}
                        </a>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-2 border text-gray-700">{renderDetails(ev)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-sm">
            <div>Showing {(paged.total ? (paged.cur-1)*pageSize + 1 : 0)}-{Math.min(paged.cur*pageSize, paged.total)} of {paged.total}</div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={paged.cur<=1} onClick={()=>setPage(paged.cur-1)}>Prev</button>
              <span>Page {paged.cur} of {paged.totalPages}</span>
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={paged.cur>=paged.totalPages} onClick={()=>setPage(paged.cur+1)}>Next</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

