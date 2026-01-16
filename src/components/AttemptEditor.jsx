import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { SCORE_SELECT_FIELDS, fetchScoreRow, fetchIppt3Row, fmtRun } from "../lib/scores";

export default function AttemptEditor({ sessionId, studentId, onSaved, isIppt3 = false }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({
    situps: "",
    pushups: "",
    pullups: "",
    broad: "",
    reach: "",
    shuttle: "",
    runMmss: "",
  });
  const [error, setError] = useState("");
  const [previous, setPrevious] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      setPrevious(null);
      setValues({
        situps: "",
        pushups: "",
        pullups: "",
        broad: "",
        reach: "",
        shuttle: "",
        runMmss: "",
      });
      if (isIppt3) {
        try {
          const data = await fetchIppt3Row(supabase, sessionId, studentId);
          if (data) {
            setPrevious(data);
            setValues((prev) => ({
              ...prev,
              situps: data.situps ?? "",
              pushups: data.pushups ?? "",
              runMmss: data.run_2400 != null ? (fmtRun(data.run_2400) || "") : "",
            }));
          }
        } catch (e) {
          setError(e?.message || "Failed to load scores.");
        } finally {
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("scores")
        .select(SCORE_SELECT_FIELDS)
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
          broad: data.broad_jump ?? "",
          reach: data.sit_and_reach ?? "",
          shuttle: data.shuttle_run ?? "",
          runMmss: data.run_2400 != null ? (fmtRun(data.run_2400) || "") : "",
        }));
      }
      setLoading(false);
    };
    load();
  }, [sessionId, studentId, isIppt3]);

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
      if (isIppt3) {
        const situps = values.situps === "" ? null : parseInt(onlyInt(values.situps) || "0", 10);
        const pushups = values.pushups === "" ? null : parseInt(onlyInt(values.pushups) || "0", 10);
        const runMmss = (values.runMmss || "").trim();
        let run_2400 = null;
        if (runMmss) {
          const m = runMmss.match(/^(\d{1,2}):(\d{2})$/);
          if (!m) throw new Error("Run must be in mm:ss");
          const mm = parseInt(m[1], 10);
          const ss = parseInt(m[2], 10);
          if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) throw new Error("Run seconds must be 00-59");
          run_2400 = Number.parseFloat(((mm * 60 + ss) / 60).toFixed(2));
        }
        const inRange = (v, min, max) => v == null || (v >= min && v <= max);
        if (!inRange(situps, 0, 60)) throw new Error("Sit-Ups must be 0-60");
        if (!inRange(pushups, 0, 60)) throw new Error("Push-Ups must be 0-60");
        const payload = {
          session_id: sessionId,
          student_id: studentId,
          situps,
          pushups,
          run_2400,
        };
        const { error } = await supabase
          .from("ippt3_scores")
          .upsert(payload, { onConflict: "session_id,student_id" });
        if (error) throw error;
        try {
          const latest = await fetchIppt3Row(supabase, sessionId, studentId);
          if (latest) setPrevious(latest);
        } catch {}
        onSaved?.();
        return;
      }
      // Coerce values with required formats (single attempt per field)
      const situps = values.situps === "" ? null : parseInt(onlyInt(values.situps) || "0", 10);
      const pullups = values.pullups === "" ? null : parseInt(onlyInt(values.pullups) || "0", 10);
      const broad = values.broad === "" ? null : parseInt(onlyInt(values.broad) || "0", 10);
      const reach = values.reach === "" ? null : parseInt(onlyInt(values.reach) || "0", 10);
      const shuttle = values.shuttle === "" ? null : Number(oneDecimal(values.shuttle));
      const runMmss = (values.runMmss || '').trim();
      let run_2400 = null;
      if (runMmss) {
        const m = runMmss.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) throw new Error('Run must be in mm:ss');
        const mm = parseInt(m[1], 10); const ss = parseInt(m[2], 10);
        if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) throw new Error('Run seconds must be 00-59');
        run_2400 = Number.parseFloat(((mm * 60 + ss) / 60).toFixed(2));
      }

      // Validate simple ranges
      const inRange = (v, min, max) => v == null || (v >= min && v <= max);
      if (!inRange(situps, 0, 60)) throw new Error('Sit-Ups must be 0-60');
      if (!inRange(pullups, 0, 60)) throw new Error('Pull-Ups must be 0-60');
      if (!inRange(broad, 0, 300)) throw new Error('Broad Jump must be 0-300 cm');
      if (!inRange(reach, 0, 80)) throw new Error('Sit & Reach must be 0-80 cm');
      if (shuttle != null) {
        const s = Number.parseFloat(Number(shuttle).toFixed(1));
        if (!(s >= 0.0 && s <= 20.0)) throw new Error('Shuttle Run must be 0.0-20.0 seconds');
      }

      const payload = {
        situps,
        pullups,
        broad_jump: broad,
        sit_and_reach: reach,
        shuttle_run: (shuttle == null || Number.isNaN(shuttle)) ? null : Number.parseFloat(Number(shuttle).toFixed(1)),
        run_2400,
      };
      if (previous) {
        const { error } = await supabase
          .from("scores")
          .update(payload)
          .eq("session_id", sessionId)
          .eq("student_id", studentId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("scores")
          .insert({ session_id: sessionId, student_id: studentId, ...payload });
        if (error) throw error;
      }
      // Refresh previous panel with latest values
      try {
        const latest = await fetchScoreRow(supabase, sessionId, studentId);
        if (latest) setPrevious(latest);
      } catch {}
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
    {isIppt3
      ? "Tip: Enter integers for reps and mm:ss for the 2.4km run."
      : "Tip: Enter one value per field. Use integers for reps/distances, 1 decimal for Shuttle Run, and mm:ss for 1.6/2.4km Run."}
  </div>

  {previous && (
    <div className="text-sm bg-gray-50 border border-gray-200 rounded p-2 mt-1">
      <div className="font-medium mb-1">Previous saved scores</div>
      {isIppt3 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div>Sit-Ups: <span className="font-semibold">{previous.situps ?? '-'}</span></div>
          <div>Push-Ups: <span className="font-semibold">{previous.pushups ?? '-'}</span></div>
          <div>2.4km Run (mm:ss): <span className="font-semibold">{fmtRun(previous.run_2400) || '-'}</span></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div>Sit-Ups: <span className="font-semibold">{previous.situps ?? '-'}</span></div>
          <div>Pull-Ups: <span className="font-semibold">{previous.pullups ?? '-'}</span></div>
          <div>Broad Jump (cm): <span className="font-semibold">{previous.broad_jump ?? '-'}</span></div>
          <div>Sit & Reach (cm): <span className="font-semibold">{previous.sit_and_reach ?? '-'}</span></div>
          <div>Shuttle Run (s): <span className="font-semibold">{previous.shuttle_run ?? '-'}</span></div>
          <div>1.6/2.4km Run (mm:ss): <span className="font-semibold">{fmtRun(previous.run_2400) || '-'}</span></div>
        </div>
      )}
    </div>
  )}

      {loading ? (
        <div className="text-sm">Loading...</div>
      ) : (
        <>
          {error && <div className="text-sm text-red-600">{error}</div>}
          {isIppt3 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Sit-Ups (reps)</label>
                <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 25" value={values.situps} onChange={set("situps")} />
              </div>
              <div>
                <label className="block text-sm mb-1">Push-Ups (reps)</label>
                <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 25" value={values.pushups} onChange={set("pushups")} />
              </div>
              <div>
                <label className="block text-sm mb-1">2.4km Run (mm:ss)</label>
                <input className="border rounded p-2 w-full" type="text" placeholder="e.g., 13:45" value={values.runMmss} onChange={set("runMmss")} />
              </div>
            </div>
          ) : (
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
                <label className="block text-sm mb-1">Broad Jump (cm)</label>
                <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 195" value={values.broad} onChange={set("broad")} />
              </div>
              <div>
                <label className="block text-sm mb-1">Sit & Reach (cm)</label>
                <input className="border rounded p-2 w-full" type="number" step="1" placeholder="e.g., 34" value={values.reach} onChange={set("reach")} />
              </div>
              <div>
                <label className="block text-sm mb-1">Shuttle Run (sec)</label>
                <input className="border rounded p-2 w-full" type="number" step="0.1" placeholder="e.g., 10.3" value={values.shuttle} onChange={set("shuttle")} />
              </div>
              <div>
                <label className="block text-sm mb-1">1.6/2.4km Run (mm:ss)</label>
                <input className="border rounded p-2 w-full" type="text" placeholder="e.g., 13:45" value={values.runMmss} onChange={set("runMmss")} />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
