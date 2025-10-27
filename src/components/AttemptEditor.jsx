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
  const [previous, setPrevious] = useState(null);

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
        setPrevious(data);
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

  const onlyInt = (val) => (val || "").toString().replace(/[^0-9]/g, "");
  const oneDecimal = (val) => {
    const s = (val || "").toString().replace(/[^0-9.]/g, "");
    const parts = s.split(".");
    if (parts.length === 1) return parts[0];
    return parts[0] + "." + parts[1].slice(0, 1);
  };
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      // Coerce values with required formats
      const situps = values.situps === "" ? null : parseInt(onlyInt(values.situps) || "0", 10);
      const pullups = values.pullups === "" ? null : parseInt(onlyInt(values.pullups) || "0", 10);
      const broad1 = values.broad1 === "" ? null : parseInt(onlyInt(values.broad1) || "0", 10);
      const broad2 = values.broad2 === "" ? null : parseInt(onlyInt(values.broad2) || "0", 10);
      const reach1 = values.reach1 === "" ? null : parseInt(onlyInt(values.reach1) || "0", 10);
      const reach2 = values.reach2 === "" ? null : parseInt(onlyInt(values.reach2) || "0", 10);
      const shuttle1 = values.shuttle1 === "" ? null : Number(oneDecimal(values.shuttle1));
      const shuttle2 = values.shuttle2 === "" ? null : Number(oneDecimal(values.shuttle2));

      const payload = {
        session_id: sessionId,
        student_id: studentId,
        situps,
        pullups,
        broad_jump: bestMax(broad1, broad2),
        sit_and_reach: bestMax(reach1, reach2),
        shuttle_run: (function(){
          const v = bestMin(shuttle1, shuttle2);
          if (v == null || Number.isNaN(v)) return null;
          return Number.parseFloat(Number(v).toFixed(1));
        })(),
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

  <div className="text-xs text-gray-700 bg-blue-50 border border-blue-200 rounded p-2">
    Tip: Broad Jump and Sit & Reach keep the higher of two attempts; Shuttle Run keeps the lower time. Sit-ups and Pull-ups are single-attempt entries. Use integers for reps/distances, and 1 decimal for Shuttle Run.
  </div>

  {previous && (
    <div className="text-sm bg-gray-50 border border-gray-200 rounded p-2 mt-1">
      <div className="font-medium mb-1">Previous saved scores</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div>Sit-Ups: <span className="font-semibold">{previous.situps ?? '-'}</span></div>
        <div>Pull-Ups: <span className="font-semibold">{previous.pullups ?? '-'}</span></div>
        <div>Broad Jump (cm): <span className="font-semibold">{previous.broad_jump ?? '-'}</span></div>
        <div>Sit & Reach (cm): <span className="font-semibold">{previous.sit_and_reach ?? '-'}</span></div>
        <div>Shuttle Run (s): <span className="font-semibold">{previous.shuttle_run ?? '-'}</span></div>
      </div>
    </div>
  )}

      {loading ? (
        <div className="text-sm">Loading...</div>
      ) : (
        <>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Sit-Ups (reps)</label>
              <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 25" value={values.situps} onChange={set("situps")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Pull-Ups (reps)</label>
              <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 8" value={values.pullups} onChange={set("pullups")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Broad Jump (cm) - Attempt 1</label>
              <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 190" value={values.broad1} onChange={set("broad1")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Broad Jump (cm) - Attempt 2</label>
              <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 195" value={values.broad2} onChange={set("broad2")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Sit & Reach (cm) - Attempt 1</label>
              <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 32" value={values.reach1} onChange={set("reach1")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Sit & Reach (cm) - Attempt 2</label>
              <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 34" value={values.reach2} onChange={set("reach2")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Shuttle Run (sec) - Attempt 1</label>
              <input className="border rounded p-2 w-full" type="number" step="0.1" placeholder="e.g., 10.3" value={values.shuttle1} onChange={set("shuttle1")} />
            </div>
            <div>
              <label className="block text-sm mb-1">Shuttle Run (sec) - Attempt 2</label>
              <input className="border rounded p-2 w-full" type="number" step="0.1" placeholder="e.g., 10.2" value={values.shuttle2} onChange={set("shuttle2")} />
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
