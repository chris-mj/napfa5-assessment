import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useToast } from "../components/ToastProvider";

export default function Charts() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState(0);
  const [students, setStudents] = useState(0);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const [sess, studs, scores] = await Promise.all([
          supabase.from("sessions").select("id", { count: "exact", head: true }),
          supabase.from("students").select("id", { count: "exact", head: true }),
          supabase.from("scores").select("id", { count: "exact", head: true }),
        ]);
        if (!ignore) {
          setSessions(sess?.count || 0);
          setStudents(studs?.count || 0);
          setAttempts(scores?.count || 0);
        }
      } catch (e) {
        if (!ignore) showToast?.("error", e?.message || "Failed to load charts.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    load();
    return () => { ignore = true; };
  }, [showToast]);

  return (
    <main className="w-full">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">Charts</h1>
          <p className="text-sm text-gray-600">High-level metrics for your school.</p>
        </header>
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border rounded p-4 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Sessions</div>
            <div className="text-2xl font-semibold">{loading ? "..." : sessions}</div>
          </div>
          <div className="border rounded p-4 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Students</div>
            <div className="text-2xl font-semibold">{loading ? "..." : students}</div>
          </div>
          <div className="border rounded p-4 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Attempts</div>
            <div className="text-2xl font-semibold">{loading ? "..." : attempts}</div>
          </div>
        </section>
        <section className="border rounded bg-white p-4 text-sm text-gray-600">
          More charts are coming soon.
        </section>
      </div>
    </main>
  );
}
