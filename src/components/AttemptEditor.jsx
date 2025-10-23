import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function bestMax(a, b) {
  const x = a == null || a === '' ? null : Number(a);
  const y = b == null || b === '' ? null : Number(b);
  if (x == null && y == null) return null;
  if (x == null) return y;
  if (y == null) return x;
  return Math.max(x, y);
}

function bestMin(a, b) {
  const x = a == null || a === '' ? null : Number(a);
  const y = b == null || b === '' ? null : Number(b);
  if (x == null && y == null) return null;
  if (x == null) return y;
  if (y == null) return x;
  return Math.min(x, y);
}

export default function AttemptEditor({ sessionId, studentId, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({
    situps: "",
    pullups: "",
    broad1: "",
    broad2: "",
    reach1: "",
    reach2: "",
    shuttle1: "",
    shuttle2: "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      const { data, error } = await supabase
        .from("scores")
        .select("situps, pullups, broad_jump, sit_and_reach, shuttle_run")
        .eq("session_id", sessionId)
        .eq("student_id", studentId)
        .maybeSingle();
      if (error) setError(error.message);
      if (data) {
        setValues((prev) => ({
          ...prev,
          situps: data.situps ?? "",
          pullups: data.pullups ?? "",
          broad1: data.broad_jump ?? "",
          broad2: "",
          reach1: data.sit_and_reach ?? "",
          reach2: "",
          shuttle1: data.shuttle_run ?? "",
          shuttle2: "",
        }));
      }
      setLoading(false);
    };
    load();
  }, [sessionId, studentId]);

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        session_id: sessionId,
        student_id: studentId,
        situps: values.situps === "" ? null : Number(values.situps),
        pullups: values.pullups === "" ? null : Number(values.pullups),
        broad_jump: bestMax(values.broad1, values.broad2),
        sit_and_reach: bestMax(values.reach1, values.reach2),
        shuttle_run: bestMin(values.shuttle1, values.shuttle2),
      };
      const { error } = await supabase
        .from("scores")
        .upsert(payload, { onConflict: "session_id,student_id" });
      if (error) throw error;
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="border rounded p-3 space-y-3">
      {loading ? (
        <div className="text-sm">Loading...</div>
      ) : (
        <>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Sit-Ups (reps)</label>
              <input className="border rounded p-2 w-full" type="number" value={values.situps} onChange={set("situps")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Pull-Ups (reps)</label>
              <input className="border rounded p-2 w-full" type="number" value={values.pullups} onChange={set("pullups")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Broad Jump (cm) — Attempt 1</label>
              <input className="border rounded p-2 w-full" type="number" step="0.1" value={values.broad1} onChange={set("broad1")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Broad Jump (cm) — Attempt 2</label>
              <input className="border rounded p-2 w-full" type="number" step="0.1" value={values.broad2} onChange={set("broad2")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Sit & Reach (cm) — Attempt 1</label>
              <input className="border rounded p-2 w-full" type="number" step="0.1" value={values.reach1} onChange={set("reach1")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Sit & Reach (cm) — Attempt 2</label>
              <input className="border rounded p-2 w-full" type="number" step="0.1" value={values.reach2} onChange={set("reach2")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Shuttle Run (sec) — Attempt 1</label>
              <input className="border rounded p-2 w-full" type="number" step="0.01" value={values.shuttle1} onChange={set("shuttle1")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Shuttle Run (sec) — Attempt 2</label>
              <input className="border rounded p-2 w-full" type="number" step="0.01" value={values.shuttle2} onChange={set("shuttle2")} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Saving..." : "Save Best Values"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

