import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "../components/ToastProvider";

export default function Profile({ user }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { showToast } = useToast();
  const [memberships, setMemberships] = useState([]);
  const [memLoading, setMemLoading] = useState(true);
  const [memOpId, setMemOpId] = useState(null);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!ignore) {
          if (error) {
            setMessage(error.message || "Failed to load profile.");
          } else {
            setFullName(data?.full_name || "");
            setEmail(data?.email || user.email || "");
          }
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    if (user?.id) load();
    return () => { ignore = true };
  }, [user?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (!fullName.trim()) { setMessage("Full name is required."); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() })
        .eq("user_id", user.id);
      if (error) {
        setMessage(error.message || "Failed to update profile.");
        showToast('error', error.message || 'Failed to update profile');
        return;
      }
      showToast('success', 'Profile updated');
      setMessage("Profile updated.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Loading profile...</div>;

  
  const deactivateMembership = async (m) => {
    if (!m?.id) return;
    if (!window.confirm(`Deactivate membership at "${m.schoolName}"? You will lose access tied to this school.`)) return;
    setMemOpId(m.id);
    try {
      const { error } = await supabase.from('memberships').delete().eq('id', m.id);
      if (error) {
        showToast('error', error.message || 'Unable to deactivate membership');
        return;
      }
      showToast('success', 'Membership deactivated');
      const { data } = await supabase
        .from('memberships')
        .select('id, role, schools:schools!inner(id, name)')
        .eq('user_id', user.id)
        .order('role');
      setMemberships((data||[]).map(r => ({ id: r.id, role: r.role, schoolName: r.schools?.name || r.schools?.id })));
    } finally {
      setMemOpId(null);
    }
  };
return (
    <main className="w-full">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Your Profile</h1>
          <p className="text-sm text-gray-600">Update your display details and manage your password.</p>
        </header>

        <section className="border rounded-lg p-4 bg-white shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {message && (<p className="text-sm text-gray-700">{message}</p>)}
            <label className="block">
              <span className="text-sm">Full Name</span>
              <input className="mt-1 border rounded p-2 w-full" value={fullName} onChange={(e)=>setFullName(e.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm">Email</span>
              <input className="mt-1 border rounded p-2 w-full opacity-70" value={email} disabled />
              <div className="text-xs text-gray-600 mt-1">To change email, contact an administrator.</div>
            </label>
            <div className="flex items-center justify-between">
              <NavLink className="text-sm text-blue-700 underline" to="/change-password">Change password</NavLink>
              <button type="submit" disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{saving ? 'Saving...' : 'Save changes'}</button>
            </div>
          </form>
        </section>

        <section className="border rounded-lg p-4 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Memberships</h2>
          </div>
          {memLoading ? (
            <div className="text-sm text-gray-600">Loading memberships...</div>
          ) : memberships.length === 0 ? (
            <div className="text-sm text-gray-600">No active memberships.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border">School</th>
                  <th className="px-3 py-2 border">Role</th>
                  <th className="px-3 py-2 border w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map(m => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 border">{m.schoolName}</td>
                    <td className="px-3 py-2 border">{m.role}</td>
                    <td className="px-3 py-2 border">
                      <button
                        className="px-2 py-1 border rounded text-red-600 disabled:opacity-50"
                        onClick={() => deactivateMembership(m)}
                        disabled={memOpId === m.id}
                      >
                        {memOpId === m.id ? 'Processing...' : 'Deactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        </div>
    </main>
  );
}














