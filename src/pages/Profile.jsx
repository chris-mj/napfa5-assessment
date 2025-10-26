import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "../components/ToastProvider";

export default function Profile({ user }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { showToast } = useToast();

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

  if (loading) return <div className="p-6">Loading profile…</div>;

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
              <a className="text-sm text-blue-700 underline" href="/change-password">Change password</a>
              <button type="submit" disabled={saving} className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

