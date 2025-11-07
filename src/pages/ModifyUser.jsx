import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from 'react-router-dom';
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";
import { useToast } from "../components/ToastProvider";

// (unused helper removed)


const ROLES = ["superadmin", "admin", "score_taker", "viewer"];

const INITIAL_FORM = {
    fullName: "",
    email: "",
    password: "",
    role: "admin",
};

export default function ModifyUser({ user }) {
    const [schools, setSchools] = useState([]);
    const [schoolId, setSchoolId] = useState("");
    const [members, setMembers] = useState([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [pendingMemberId, setPendingMemberId] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const [query, setQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(100);
    const [addOpen, setAddOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileForm, setProfileForm] = useState({ fullName: "", email: "" });
    const [profileFeedback, setProfileFeedback] = useState(null);
    

    const { showToast } = useToast();

    const platformOwner = isPlatformOwner(user);

    useEffect(() => {
        if (!user) return;
        (async () => {
            if (platformOwner) {
                const { data, error } = await supabase
                    .from('schools')
                    .select('id, name, type')
                    .order('name');
                if (error) {
                    console.error('Failed to load schools:', error.message);
                    setFeedback({ type: 'error', text: 'Unable to load schools.' });
                    return;
                }
                setSchools(data || []);
            } else {
                const { data, error } = await supabase
                    .from('memberships')
                    .select('role, schools:schools!inner(id, name, type)')
                    .eq('user_id', user.id)
                    .in('role', ['admin','superadmin']);
                if (error) {
                    console.error('Failed to load schools:', error.message);
                    setFeedback({ type: 'error', text: 'Unable to load schools.' });
                    return;
                }
                setSchools((data || []).map((record) => record.schools));
            }
        })();
    }, [platformOwner, user]);

    useEffect(() => {
        const calc = () => setPageSize(window.innerWidth < 768 ? 40 : 100);
        calc();
        window.addEventListener("resize", calc);
        return () => window.removeEventListener("resize", calc);
    }, []);

    useEffect(() => {
        if (!schools.length) {
            setSchoolId("");
            setMembers([]);
            return;
        }
        if (!schoolId || !schools.some((school) => school.id === schoolId)) {
            setSchoolId(schools[0].id);
        }
    }, [schools, schoolId]);

    const [currentRole, setCurrentRole] = useState("");

    const loadMembers = useCallback(
        async (targetSchoolId) => {
            const resolvedSchoolId = targetSchoolId || schoolId;
            if (!resolvedSchoolId) return;
            setMembersLoading(true);
            // Determine current user's role for this school
            try {
                const { data: mymem } = await supabase
                  .from('memberships')
                  .select('role')
                  .eq('user_id', user.id)
                  .eq('school_id', resolvedSchoolId)
                  .maybeSingle();
                setCurrentRole(String(mymem?.role || ''));
            } catch {}
            const { data, error } = await supabase.rpc('list_school_memberships', { p_school: resolvedSchoolId });
            if (error) {
                console.error("Failed to fetch members:", error.message);
                setFeedback({ type: "error", text: "Unable to load users for the selected school." });
                setMembers([]);
            } else {
                const rows = (data || []).map((row) => ({ id: row.membership_id, role: row.role, userId: row.user_id, fullName: row.full_name || '', email: row.email || '' }));
                rows.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
                setMembers(rows);
            }
            setMembersLoading(false);
        },
        [schoolId]
    );

    useEffect(() => {
        if (!schoolId) {
            setMembers([]);
            return;
        }
        loadMembers(schoolId);
    }, [schoolId, loadMembers]);

    useEffect(() => {
        if (!schoolId) return;
        const channel = supabase
            .channel(`memberships:${schoolId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "memberships", filter: `school_id=eq.${schoolId}` },
                () => {
                    loadMembers(schoolId);
                }
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [schoolId, loadMembers]);

    const memberEmails = useMemo(
        () => new Set(members.map((member) => member.email.toLowerCase())),
        [members]
    );

    const handleInputChange = (field) => (event) => {
        setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

    const openOwnProfile = (member) => {
        if (!member) return;
        setProfileFeedback(null);
        setProfileForm({ fullName: member.fullName || "", email: member.email || "" });
        setProfileOpen(true);
    };

    const handleProfileInput = (field) => (e) => {
        setProfileFeedback(null);
        setProfileForm((p) => ({ ...p, [field]: e.target.value }));
    };

    const saveOwnProfile = async (e) => {
        e?.preventDefault?.();
        setProfileFeedback(null);
        if (!profileForm.fullName?.trim()) {
            setProfileFeedback({ type: 'error', text: 'Full name is required.' });
            return;
        }
        setProfileSaving(true);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ full_name: profileForm.fullName.trim() })
                .eq('user_id', user.id);
            if (error) {
                setProfileFeedback({ type: 'error', text: error.message || 'Failed to update profile.' });
                showToast('error', error.message || 'Failed to update profile');
                return;
            }
            showToast('success', 'Profile updated');
            setProfileOpen(false);
            await loadMembers(schoolId);
        } finally {
            setProfileSaving(false);
        }
    };

    const handleAddUser = async (event) => {
        event.preventDefault();
        setFeedback(null);

        if (!schoolId) {
            setFeedback({ type: "error", text: "Select a school first." });
            return;
        }

        if (!form.fullName || !form.email || !form.password) {
            setFeedback({ type: "error", text: "Fill in full name, email, and password." });
            return;
        }

        if (memberEmails.has(form.email.toLowerCase())) {
            setFeedback({ type: "error", text: "A user with this email is already linked to the school." });
            return;
        }

        // Role restriction: platform owner bypasses; admin may add admin/score_taker/viewer
        const targetRole = String(form.role || '').toLowerCase();
        if (!platformOwner && currentRole === 'admin' && !(targetRole === 'admin' || targetRole === 'score_taker' || targetRole === 'viewer')) {
            setFeedback({ type: 'error', text: 'Admins may only add admin, score_taker or viewer roles.' });
            return;
        }
        // Proceed with add; backend will error if user belongs to another school
        await doAddUser();
        return;
    };


    // Perform add/link flow and enforce single-school membership
    async function doAddUser() {
  setSubmitting(true);
  try {
    const { error } = await supabase.rpc('create_membership', {
      p_email: form.email,
      p_school: schoolId,
      p_role: form.role,
    });
    if (error?.code === 'P0002' || error?.message === 'AUTH_USER_MISSING') {
      setFeedback({ type: 'info', text: 'Creating new user...' });
      const apiBase = import.meta.env.DEV ? 'https://napfa5-assessment.vercel.app' : '';
      const response = await fetch(`${apiBase}/api/createUser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password || 'test1234', fullName: form.fullName }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFeedback({ type: 'error', text: 'User creation failed: ' + (result.error || '') });
        showToast('error', 'User creation failed: ' + (result.error || ''));
        return;
      }
      const { error: addErr } = await supabase.rpc('create_membership', {
        p_email: form.email,
        p_school: schoolId,
        p_role: form.role,
      });
      if (addErr) {
        setFeedback({ type: 'error', text: addErr.message || 'Failed to link user' });
        showToast('error', addErr.message || 'Failed to link user');
        return;
      }
      setFeedback({ type: 'success', text: 'User created and linked successfully.' });
      showToast('success', 'User created and linked successfully');
      setForm(INITIAL_FORM);
      setAddOpen(false);
      await loadMembers(schoolId);
      return;
    }
    if (error) {
      setFeedback({ type: 'error', text: error.message || 'Failed to link user' });
      showToast('error', error.message || 'Failed to link user');
      return;
    }
    setFeedback({ type: 'success', text: 'User linked successfully.' });
    showToast('success', 'User linked successfully');
    setForm(INITIAL_FORM);
    setAddOpen(false);
    await loadMembers(schoolId);
  } finally {
    setSubmitting(false);
  }
}

    const handleRoleUpdate = async (member, newRole) => {
        if (member.role === newRole) return;
        setFeedback(null);
        // Restrict admin actions
        const curr = String(currentRole || '').toLowerCase();
        const targetNew = String(newRole || '').toLowerCase();
        const targetExisting = String(member.role || '').toLowerCase();
        if (curr === 'admin') {
            if (!(targetExisting === 'score_taker' || targetExisting === 'viewer')) {
                setFeedback({ type: 'error', text: 'Admins may only modify score_taker or viewer.' });
                showToast('error', 'Admins may only modify score_taker or viewer');
                return;
            }
            if (!(targetNew === 'score_taker' || targetNew === 'viewer')) {
                setFeedback({ type: 'error', text: 'Admins may only set role to score_taker or viewer.' });
                showToast('error', 'Admins may only set role to score_taker or viewer');
                return;
            }
        }
        setPendingMemberId(member.id);
        try {
            const { error } = await supabase.rpc('update_membership_role', { p_membership_id: member.id, p_role: newRole });
            if (error) {
                setFeedback({ type: 'error', text: error.message || 'Unable to update role.' });
                showToast('error', error.message || 'Unable to update role');
                return;
            }
            setFeedback({ type: 'success', text: 'Role updated.' });
            showToast('success', 'Role updated')
            await loadMembers();
        } finally {
            setPendingMemberId(null);
        }
    };


    const handleRemoveMember = async (member) => {
        if (member.userId === user?.id) {
            setFeedback({ type: "error", text: "You cannot remove your own membership." });
            return;
        }
        if (String(currentRole||'').toLowerCase() === 'admin') {
            const r = String(member.role||'').toLowerCase();
            if (!(r === 'score_taker' || r === 'viewer')) {
                setFeedback({ type: 'error', text: 'Admins may only remove score_taker or viewer.' });
                showToast('error', 'Admins may only remove score_taker or viewer');
                return;
            }
        }
        const confirmed = window.confirm(
            `Remove ${member.fullName || member.email} from this school?`
        );
        if (!confirmed) return;

        setFeedback(null);
        setPendingMemberId(member.id);
        try {
            const { error } = await supabase
                .rpc('delete_membership', { p_membership_id: member.id });
            if (error) {
                setFeedback({ type: "error", text: error.message || "Unable to remove user." });
                showToast('error', error.message || 'Unable to remove user')
                return;
            }
            setFeedback({ type: "success", text: "User removed from the school." });
            showToast('success', 'User removed from the school')
            await loadMembers();
        } finally {
            setPendingMemberId(null);
        }
    };

    const canAccess = platformOwner || schools.length > 0; // schools pre-filtered to admin/superadmin for non-owner

    if (!user) return <div className="p-6">Please login.</div>;
    if (!canAccess) return <div className="p-6 text-red-600">Access denied.</div>;

    return (
        <main className="w-full">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold">Manage Users</h1>
              <p className="text-sm text-gray-600">Add users to your school, update roles, and remove access.</p>
            </header>

            <section className="border rounded-lg p-4 bg-white shadow-sm">
              <h2 className="text-lg font-semibold mb-3">Context</h2>
              <div className="grid gap-3 md:grid-cols-2">
  <label className="text-sm">
    School
    <select value={schoolId} onChange={(e)=>{ setSchoolId(e.target.value); setPage(1) }} className="border rounded p-2 w-full mt-1">
      <option value="">Select a school</option>
      {schools.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
    </select>
    <div className="text-xs text-gray-600 mt-1">
      {(() => {
        const s = (schools || []).find(x => x.id === schoolId);
        if (!s) return null;
        const label = s.type === 'primary' ? 'Primary' : (s.type === 'secondaryJC' ? 'Secondary/JC' : (s.type || '-'));
        const tone = s.type === "primary" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-700 border-gray-300";
        return (<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${tone}`}>{label}</span>);
      })()}
    </div>
  </label>
  <div className="text-sm text-gray-700 border rounded p-3 bg-gray-50">
    <div className="font-medium mb-1">Role legend</div>
    <div className="flex flex-wrap gap-3">
      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800">admin/superadmin</span>
      <span>Manage students, enrollments, sessions & roster; record scores.</span>
    </div>
    <div className="flex flex-wrap gap-3 mt-2">
      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">score_taker</span>
      <span>Record scores when session is Active; cannot manage roster.</span>
    </div>
  </div>
</div>            </section>

            {/* Add user moved to modal; use button in list header */}

            <div className="border rounded p-4 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">Existing Users</h2>
                  {(platformOwner || currentRole === 'superadmin' || currentRole === 'admin') && (
                    <button onClick={()=>setAddOpen(true)} disabled={!schoolId} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Add User</button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                    <input value={query} onChange={(e)=>{ setQuery(e.target.value); setPage(1) }} placeholder="Search by name or email" className="p-2 border rounded w-full md:max-w-sm" />
                    <select value={roleFilter} onChange={(e)=>{ setRoleFilter(e.target.value); setPage(1) }} className="p-2 border rounded"><option value="">All roles</option>{ROLES.map(r => (<option key={r} value={r}>{r}</option>))}</select>
                </div>
                {membersLoading ? (
                    <p>Loading users...</p>
                ) : members.length === 0 ? (
                    <p className="text-sm text-gray-600">No users linked to this school yet.</p>
                ) : (
                    <table className="min-w-full border text-sm">
                        <thead>
                            <tr className="bg-gray-100 text-left">
                                <th className="border px-3 py-2">Name</th>
                                <th className="border px-3 py-2">Email</th>
                                <th className="border px-3 py-2">Role</th>
                                <th className="border px-3 py-2 w-32">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(() => {
                                const q = query.trim().toLowerCase();
                                const filtered = members.filter(m => (!q || (m.fullName||"").toLowerCase().includes(q) || (m.email||"").toLowerCase().includes(q)) && (!roleFilter || m.role === roleFilter));
                                const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
                                const cur = Math.min(page, totalPages);
                                const start = (cur - 1) * pageSize;
                                const items = filtered.slice(start, start + pageSize);
                                // render
                                return items.map((member) => (
                                <tr key={member.id}>
                                    <td className="border px-3 py-2">{member.fullName || "--"}</td>
                                    <td
                                        className={`border px-3 py-2 ${member.userId === user.id ? 'cursor-pointer underline decoration-dotted' : ''}`}
                                        title={member.userId === user.id ? 'View/edit your profile' : ''}
                                        onClick={() => { if (member.userId === user.id) openOwnProfile(member); }}
                                    >
                                        {member.email}
                                    </td>
                                    <td className="border px-3 py-2">
                                        <select
                                            value={member.role}
                                            onChange={(event) =>
                                                handleRoleUpdate(member, event.target.value)
                                            }
                                            className="border rounded p-1 w-full"
                                            disabled={pendingMemberId === member.id}
                                            onClick={(e)=>e.stopPropagation()}
                                        >
                                            {ROLES.map((roleOption) => (
                                                <option key={roleOption} value={roleOption}>
                                                    {roleOption}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="border px-3 py-2">
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveMember(member)}
                                            className="text-red-600 hover:underline disabled:text-red-300"
                                            disabled={pendingMemberId === member.id}
                                        >
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                                ))
                            })()}
                        </tbody>
                    </table>
                )}
                {/* Pagination footer */}
                {!membersLoading && members.length > 0 && (
                  <div className="flex items-center justify-between text-sm mt-2">
                    <div>
                      {(() => {
                        const q = query.trim().toLowerCase();
                        const total = members.filter(m => (!q || (m.fullName||"").toLowerCase().includes(q) || (m.email||"").toLowerCase().includes(q)) && (!roleFilter || m.role === roleFilter)).length;
                        const totalPages = Math.max(1, Math.ceil(total / pageSize));
                        const cur = Math.min(page, totalPages);
                        const start = (cur-1)*pageSize + (total?1:0);
                        const end = Math.min(cur*pageSize, total);
                        return `Showing ${start}-${end} of ${total}`;
                      })()}
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const q = query.trim().toLowerCase();
                        const total = members.filter(m => (!q || (m.fullName||"").toLowerCase().includes(q) || (m.email||"").toLowerCase().includes(q)) && (!roleFilter || m.role === roleFilter)).length;
                        const totalPages = Math.max(1, Math.ceil(total / pageSize));
                        const cur = Math.min(page, totalPages);
                        return (
                          <>
                            <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={cur<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
                            <div>Page {cur} / {totalPages}</div>
                            <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={cur>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
            </div>

            {feedback && (
                <p className={`text-sm ${feedback.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>{feedback.text}</p>
            )}

            {addOpen && (
              <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                <div className="bg-white rounded shadow-xl w-full max-w-xl" onClick={(e)=>e.stopPropagation()}>
                  <div className="px-4 py-2 border-b flex items-center justify-between">
                    <div className="font-medium">Add User to School</div>
                    <button className="px-2 py-1 border rounded" onClick={()=>setAddOpen(false)}>Close</button>
                  </div>
                  <form onSubmit={(e)=>{ handleAddUser(e); }} className="p-4 space-y-3">
                    <div className="text-xs text-gray-600">School: {schools.find(s=>s.id===schoolId)?.name || '-'} { !schoolId && '(select a school first)'}</div>
                    <div>
                      <label className="block text-sm mb-1">Role</label>
                      <select value={form.role} onChange={handleInputChange('role')} className="border rounded p-2 w-full">
                        {ROLES.filter(r => platformOwner ? true : (currentRole === 'superadmin' ? true : (currentRole === 'admin' ? (r === 'admin' || r === 'score_taker' || r === 'viewer') : (r === 'score_taker' || r === 'viewer')))).map((role) => (<option key={role} value={role}>{role}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Full Name</label>
                      <input value={form.fullName} onChange={handleInputChange('fullName')} className="border rounded p-2 w-full" required />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Email</label>
                      <input type="email" value={form.email} onChange={handleInputChange('email')} className="border rounded p-2 w-full" required />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Password</label>
                      <input type="password" value={form.password} onChange={handleInputChange('password')} className="border rounded p-2 w-full" required />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button type="button" onClick={()=>setAddOpen(false)} className="px-3 py-2 border rounded hover:bg-gray-50">Cancel</button>
                      <button type="submit" className="px-3 py-2 bg-green-600 text-white rounded disabled:opacity-50" disabled={submitting || !schoolId || !(platformOwner || currentRole==='superadmin' || currentRole==='admin')}>{submitting ? 'Processing...' : 'Add / Link User'}</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {profileOpen && (
              <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                <div className="bg-white rounded shadow-xl w-full max-w-xl" onClick={(e)=>e.stopPropagation()}>
                  <div className="px-4 py-2 border-b flex items-center justify-between">
                    <div className="font-medium">Your Profile</div>
                    <button className="px-2 py-1 border rounded" onClick={()=>setProfileOpen(false)}>Close</button>
                  </div>
                  <form onSubmit={saveOwnProfile} className="p-4 space-y-3">
                    {profileFeedback && (
                      <p className={`text-sm ${profileFeedback.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>{profileFeedback.text}</p>
                    )}
                    <div>
                      <label className="block text-sm mb-1">Full Name</label>
                      <input value={profileForm.fullName} onChange={handleProfileInput('fullName')} className="border rounded p-2 w-full" required />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Email</label>
                      <input type="email" value={profileForm.email} onChange={handleProfileInput('email')} className="border rounded p-2 w-full opacity-70" disabled />
                      <div className="text-xs text-gray-600 mt-1">Email changes are managed via account settings.</div>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <NavLink className="text-sm text-blue-700 underline" to="/change-password">Change password</NavLink>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={()=>setProfileOpen(false)} className="px-3 py-2 border rounded hover:bg-gray-50">Cancel</button>
                        <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50" disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save changes'}</button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </main>
    );
}





























