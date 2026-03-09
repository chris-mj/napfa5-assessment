import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { normalizeStudentId } from "../utils/ids";
import { parseGroupQr } from "../utils/groupQr";
import { SitupsIcon, BroadJumpIcon, ReachIcon, PullupsIcon, ShuttleIcon, PushupsIcon } from "../components/icons/StationIcons";
import { Select, SelectTrigger, SelectContent, SelectItem } from "../components/ui/select";
import { AnimatePresence, motion } from "framer-motion";

const ROLE_CAN_SCORE = ["superadmin", "admin", "score_taker"];

export default function ScoreEntryGroup({ user }) {
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [roleAllowed, setRoleAllowed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeStation, setActiveStation] = useState("situps");
  const [groupCodeInput, setGroupCodeInput] = useState("");
  const [sessionGroups, setSessionGroups] = useState([]);
  const [group, setGroup] = useState(null);
  const [rows, setRows] = useState([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saveAllBusy, setSaveAllBusy] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolRowId, setToolRowId] = useState(null);
  const [counterValue, setCounterValue] = useState(0);
  const [countdownDefault, setCountdownDefault] = useState(60);
  const [countdownLeft, setCountdownLeft] = useState(60);
  const [countdownRunning, setCountdownRunning] = useState(false);
  const [stopwatchMs, setStopwatchMs] = useState(0);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const stopwatchStartRef = useRef(0);
  const stopwatchBaseMsRef = useRef(0);

  const currentSession = useMemo(() => (sessions || []).find((s) => s.id === sessionId) || null, [sessions, sessionId]);
  const isIppt3 = String(currentSession?.assessment_type || "NAPFA5").toUpperCase() === "IPPT3";
  const activeNapfaSessions = useMemo(
    () => (sessions || []).filter((s) => String(s?.assessment_type || "NAPFA5").toUpperCase() === "NAPFA5"),
    [sessions]
  );
  const hasMultipleNapfaSessions = activeNapfaSessions.length > 1;
  const toolStationEnabled = activeStation === "situps" || activeStation === "pullups" || activeStation === "pushups" || activeStation === "shuttle_run";
  const stations = useMemo(() => (
    isIppt3
      ? [
          { key: "situps", name: "Sit-ups", Icon: SitupsIcon },
          { key: "pushups", name: "Push-ups", Icon: PushupsIcon },
          { key: "run", name: "2.4km Run", Icon: Timer },
        ]
      : [
          { key: "situps", name: "Sit-ups", Icon: SitupsIcon },
          { key: "broad_jump", name: "Broad Jump", Icon: BroadJumpIcon },
          { key: "sit_and_reach", name: "Sit & Reach", Icon: ReachIcon },
          { key: "pullups", name: "Pull-ups", Icon: PullupsIcon },
          { key: "shuttle_run", name: "Shuttle Run", Icon: ShuttleIcon },
          { key: "run", name: "1.6/2.4km Run", Icon: Timer },
        ]
  ), [isIppt3]);

  useEffect(() => {
    const allowed = new Set(stations.map((s) => s.key));
    if (!allowed.has(activeStation)) setActiveStation(stations[0]?.key || "situps");
  }, [stations, activeStation]);

  useEffect(() => {
    if (activeStation === "situps" || activeStation === "pushups") {
      setCountdownDefault(60);
      setCountdownLeft(60);
      setCounterValue(0);
      setStopwatchRunning(false);
      setStopwatchMs(0);
      stopwatchBaseMsRef.current = 0;
      return;
    }
    if (activeStation === "pullups") {
      setCountdownDefault(30);
      setCountdownLeft(30);
      setCounterValue(0);
      setStopwatchRunning(false);
      setStopwatchMs(0);
      stopwatchBaseMsRef.current = 0;
      return;
    }
    if (activeStation === "shuttle_run") {
      setCountdownRunning(false);
      setCountdownDefault(30);
      setCountdownLeft(30);
      setCounterValue(0);
      setStopwatchRunning(false);
      setStopwatchMs(0);
      stopwatchBaseMsRef.current = 0;
      return;
    }
    setToolsOpen(false);
    setCountdownRunning(false);
    setStopwatchRunning(false);
  }, [activeStation]);

  useEffect(() => {
    if (!countdownRunning) return undefined;
    const id = setInterval(() => {
      setCountdownLeft((prev) => {
        if (prev <= 1) {
          setCountdownRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdownRunning]);

  useEffect(() => {
    if (!stopwatchRunning) return undefined;
    stopwatchStartRef.current = Date.now();
    const id = setInterval(() => {
      const delta = Date.now() - stopwatchStartRef.current;
      setStopwatchMs(stopwatchBaseMsRef.current + delta);
    }, 100);
    return () => clearInterval(id);
  }, [stopwatchRunning]);

  useEffect(() => {
    if (toolsOpen || !toolStationEnabled) return;
    setCountdownRunning(false);
    if (stopwatchRunning) {
      stopwatchBaseMsRef.current = stopwatchMs;
      setStopwatchRunning(false);
    }
  }, [toolsOpen, toolStationEnabled, stopwatchRunning, stopwatchMs]);

  useEffect(() => {
    const init = async () => {
      if (!user?.id) return;
      setLoading(true);
      setError("");
      try {
        const { data: mem, error: mErr } = await supabase
          .from("memberships")
          .select("school_id, role")
          .eq("user_id", user.id);
        if (mErr) throw mErr;
        const rows = mem || [];
        if (!rows.length) throw new Error("No school membership found.");
        const schoolId = rows[0]?.school_id;
        const roles = rows.map((r) => String(r.role || "").toLowerCase());
        setRoleAllowed(roles.some((r) => ROLE_CAN_SCORE.includes(r)));
        const { data: sess, error: sErr } = await supabase
          .from("sessions")
          .select("id, title, session_date, status, assessment_type")
          .eq("school_id", schoolId)
          .eq("status", "active")
          .order("session_date", { ascending: true });
        if (sErr) throw sErr;
        setSessions(sess || []);
        if ((sess || []).length === 1) setSessionId(sess[0].id);
      } catch (e) {
        setError(e.message || "Failed to load sessions.");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [user?.id]);

  const fetchGroupMembers = async (sid, groupCode) => {
    setError("");
    if (!sid) {
      setError("Select a session first.");
      return;
    }
    setLoading(true);
    try {
      const code = String(groupCode || "").trim().toUpperCase();
      const { data: grp, error: gErr } = await supabase
        .from("session_groups")
        .select("id, session_id, group_code, group_name")
        .eq("session_id", sid)
        .eq("group_code", code)
        .maybeSingle();
      if (gErr) throw gErr;
      if (!grp?.id) throw new Error("Group not found in selected session.");
      const sessionYear = currentSession?.session_date ? new Date(currentSession.session_date).getFullYear() : null;
      const { data: mRows, error: mErr } = await supabase
        .from("session_group_members")
        .select("student_id, students!inner(id, student_identifier, name, gender, dob, enrollments!left(class, academic_year, is_active))")
        .eq("session_id", sid)
        .eq("session_group_id", grp.id);
      if (mErr) throw mErr;
      const list = (mRows || []).map((r) => {
        const s = r.students || {};
        const ens = Array.isArray(s.enrollments) ? s.enrollments : [];
        let className = "";
        if (sessionYear != null) {
          const m = ens.find((e) => e && String(e.academic_year) === String(sessionYear) && e.is_active);
          className = m?.class || "";
        }
        if (!className && ens.length) {
          const sorted = [...ens].sort((a, b) => (b.academic_year || 0) - (a.academic_year || 0));
          className = sorted[0]?.class || "";
        }
        return {
          studentId: s.id,
          sid: normalizeStudentId(s.student_identifier || ""),
          name: s.name || "",
          className,
          scoreInput: "",
          existing: null,
          dirty: false,
          status: "",
        };
      });
      list.sort((a, b) => String(a.className || "").localeCompare(String(b.className || ""), undefined, { numeric: true, sensitivity: "base" }) || String(a.name || "").localeCompare(String(b.name || "")));
      setGroup(grp);
      setRows(list);
      setGroupCodeInput(code);
    } catch (e) {
      setGroup(null);
      setRows([]);
      setError(e.message || "Failed to load group.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadExisting = async () => {
      if (!sessionId || !group?.id || !rows.length) return;
      const ids = rows.map((r) => r.studentId);
      try {
        if (isIppt3) {
          const { data, error: e3 } = await supabase
            .from("ippt3_scores")
            .select("student_id, situps, pushups, run_2400")
            .eq("session_id", sessionId)
            .in("student_id", ids);
          if (e3) throw e3;
          const byId = new Map((data || []).map((r) => [r.student_id, r]));
          setRows((prev) => prev.map((r) => {
            const row = byId.get(r.studentId) || {};
            const v = scoreToInput(activeStation, row, true);
            return { ...r, existing: v || null, scoreInput: v || "", dirty: false, status: "" };
          }));
          return;
        }
        const { data, error: e2 } = await supabase
          .from("scores")
          .select("student_id, situps, broad_jump, sit_and_reach, pullups, shuttle_run, run_2400")
          .eq("session_id", sessionId)
          .in("student_id", ids);
        if (e2) throw e2;
        const byId = new Map((data || []).map((r) => [r.student_id, r]));
        setRows((prev) => prev.map((r) => {
          const row = byId.get(r.studentId) || {};
          const v = scoreToInput(activeStation, row, false);
          return { ...r, existing: v || null, scoreInput: v || "", dirty: false, status: "" };
        }));
      } catch (e) {
        setError(e.message || "Failed to load existing scores.");
      }
    };
    loadExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, group?.id, activeStation, isIppt3]);

  useEffect(() => {
    const loadSessionGroups = async () => {
      if (!sessionId) {
        setSessionGroups([]);
        return;
      }
      try {
        const { data, error: gErr } = await supabase
          .from("session_groups")
          .select("id, group_code, group_name")
          .eq("session_id", sessionId)
          .order("group_code", { ascending: true });
        if (gErr) throw gErr;
        setSessionGroups(data || []);
      } catch {
        setSessionGroups([]);
      }
    };
    loadSessionGroups();
  }, [sessionId]);

  useEffect(() => {
    if (!rows.length) {
      if (toolRowId) setToolRowId(null);
      return;
    }
    const exists = rows.some((r) => r.studentId === toolRowId);
    if (!exists) setToolRowId(rows[0].studentId);
  }, [rows, toolRowId]);

  const saveOne = async (row) => {
    const parsed = parseStationInput(activeStation, row.scoreInput, isIppt3);
    if (!parsed.ok) {
      setRows((prev) => prev.map((r) => (r.studentId === row.studentId ? { ...r, status: parsed.error || "Invalid", dirty: true } : r)));
      return false;
    }
    const value = parsed.value;
    try {
      if (isIppt3) {
        const colMap = { situps: "situps", pushups: "pushups", run: "run_2400" };
        const payload = { session_id: sessionId, student_id: row.studentId, [colMap[activeStation]]: value };
        const { error } = await supabase.from("ippt3_scores").upsert([payload], { onConflict: "session_id,student_id" });
        if (error) throw error;
      } else {
        const colMap = { situps: "situps", broad_jump: "broad_jump", sit_and_reach: "sit_and_reach", pullups: "pullups", shuttle_run: "shuttle_run", run: "run_2400" };
        const payload = { session_id: sessionId, student_id: row.studentId, [colMap[activeStation]]: value };
        const { error } = await supabase.from("scores").upsert([payload], { onConflict: "session_id,student_id" });
        if (error) throw error;
      }
      setRows((prev) => prev.map((r) => (r.studentId === row.studentId ? { ...r, status: "Saved", dirty: false, existing: row.scoreInput } : r)));
      return true;
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.studentId === row.studentId ? { ...r, status: e.message || "Save failed", dirty: true } : r)));
      return false;
    }
  };

  const saveAll = async () => {
    const targets = rows.filter((r) => r.dirty || (r.scoreInput || "") !== String(r.existing || ""));
    if (!targets.length) {
      setError("No changed rows to save.");
      return;
    }
    setSaveAllBusy(true);
    setError("");
    try {
      for (const r of targets) {
        // sequential to keep feedback stable and avoid large burst
        // eslint-disable-next-line no-await-in-loop
        await saveOne(r);
      }
    } finally {
      setSaveAllBusy(false);
    }
  };

  const targetRow = useMemo(() => rows.find((r) => r.studentId === toolRowId) || null, [rows, toolRowId]);

  const applyToolValueToRow = (value) => {
    if (!toolRowId) return;
    const text = String(value ?? "");
    setRows((prev) => prev.map((x) => (x.studentId === toolRowId ? { ...x, scoreInput: text, dirty: true, status: "" } : x)));
  };

  const resetCountdown = () => {
    setCountdownRunning(false);
    setCountdownLeft(countdownDefault);
  };

  const applyCounterToScore = () => {
    applyToolValueToRow(Math.max(0, counterValue));
  };

  const applyStopwatchToScore = () => {
    const seconds = Math.max(0, Number((stopwatchMs / 1000).toFixed(1)));
    applyToolValueToRow(seconds);
  };

  const formatClock = (totalSeconds) => {
    const sec = Math.max(0, Math.floor(totalSeconds || 0));
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const formatStopwatch = (ms) => (Math.max(0, ms) / 1000).toFixed(1);

  if (!roleAllowed && !loading) {
    return (
      <main className="max-w-6xl mx-auto p-4">
        <h1 className="text-2xl font-semibold mb-2">Score Entry (Group)</h1>
        <div className="border rounded p-3 bg-white text-sm text-red-700">You do not have permission to access this page.</div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Score Entry (Group)</h1>
        <p className="text-sm text-gray-600">Scan a group QR to load students, then save scores per student or save all changed rows.</p>
      </section>

      <section className="border rounded-lg bg-white p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={`rounded-lg border p-2 ${hasMultipleNapfaSessions ? "border-amber-300 bg-amber-50/60" : "border-blue-200 bg-blue-50/40"}`}>
            <div className="flex items-center justify-between gap-2">
              <label className={`text-sm font-semibold ${hasMultipleNapfaSessions ? "text-amber-900" : "text-slate-800"}`}>Session</label>
              <span className={`inline-flex items-center text-xs font-medium border rounded-full px-2 py-0.5 ${hasMultipleNapfaSessions ? "bg-amber-100 text-amber-900 border-amber-300" : "bg-blue-600 text-white border-blue-600"}`}>
                {currentSession ? `${currentSession.title}${currentSession.session_date ? ` (${currentSession.session_date})` : ""}` : "Select session"}
              </span>
            </div>
            <select className={`mt-1 w-full border rounded px-3 py-2 ${hasMultipleNapfaSessions ? "border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400" : ""}`} value={sessionId} onChange={(e) => { setSessionId(e.target.value); setGroup(null); setRows([]); setGroupCodeInput(""); }}>
              <option value="">Select active session</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{`${s.title} (${s.session_date || "-"})`}</option>)}
            </select>
            <div className={`mt-1 text-xs ${hasMultipleNapfaSessions ? "text-amber-800 font-medium" : "text-blue-800"}`}>
              {hasMultipleNapfaSessions
                ? "Multiple active NAPFA sessions detected. Verify the selected session before loading/scoring."
                : "Check the selected session before loading groups."}
            </div>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-slate-800">Station</label>
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-600 text-white border border-blue-600 rounded-full px-2 py-0.5">
                {(() => {
                  const active = stations.find((s) => s.key === activeStation);
                  const Icon = active?.Icon;
                  return Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null;
                })()}
                {stations.find((s) => s.key === activeStation)?.name || "Select station"}
              </span>
            </div>
            <div className="mt-2 relative">
              <Select value={activeStation} onValueChange={setActiveStation}>
                <SelectTrigger className="w-full rounded-full px-4 py-2 text-sm bg-white border-[3px] border-blue-600 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <span className="flex items-center gap-2 flex-1">
                    {(() => {
                      const active = stations.find((s) => s.key === activeStation);
                      const Icon = active?.Icon;
                      return Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null;
                    })()}
                    <span className="truncate">{stations.find((s) => s.key === activeStation)?.name || "Select station"}</span>
                  </span>
                </SelectTrigger>
                <SelectContent className="rounded-2xl border border-slate-200 shadow-lg bg-white">
                  {stations.map((s) => (
                    <SelectItem key={s.key} value={s.key} className="flex items-center gap-2">
                      {s.Icon ? <s.Icon className="h-4 w-4" aria-hidden="true" /> : null}
                      <span>{s.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-1 text-xs text-blue-800">Check the selected station before entering scores.</div>
          </div>
          <div>
            <label className="text-sm text-gray-700">Group Code</label>
            <select
              className="mt-1 w-full border rounded px-3 py-2 bg-white"
              value={groupCodeInput}
              onChange={(e) => {
                const code = e.target.value;
                setGroupCodeInput(code);
                if (code) fetchGroupMembers(sessionId, code);
              }}
            >
              <option value="">Select group from list</option>
              {sessionGroups.map((g) => (
                <option key={g.id} value={g.group_code}>
                  {g.group_code}{g.group_name ? ` - ${g.group_name}` : ""}
                </option>
              ))}
            </select>
            <div className="mt-1 flex gap-2">
              <input value={groupCodeInput} onChange={(e) => setGroupCodeInput(e.target.value.toUpperCase())} className="border rounded px-3 py-2 w-full" placeholder="e.g. G01" />
              <button type="button" onClick={() => fetchGroupMembers(sessionId, groupCodeInput)} className="px-3 py-2 border rounded hover:bg-gray-50">Load</button>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="px-3 py-2 border rounded hover:bg-gray-50"
                aria-label="Scan group QR"
                title="Scan group QR"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        {group && (
          <div className="text-sm text-gray-700">
            Loaded group: <span className="font-semibold">{group.group_code}</span>{group.group_name ? ` - ${group.group_name}` : ""} ({rows.length} students)
          </div>
        )}
        {error && <div className="text-sm text-red-600">{error}</div>}
      </section>

      <section className="border rounded-lg bg-white overflow-x-auto">
        <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">Group Students</div>
            <span className="text-xs font-semibold text-blue-900 bg-blue-100 border border-blue-300 rounded-full px-2 py-0.5">
              Now scoring: {stations.find((s) => s.key === activeStation)?.name || "-"}
            </span>
            {targetRow && (
              <span className="text-xs font-semibold text-emerald-900 bg-emerald-100 border border-emerald-300 rounded-full px-2 py-0.5">
                Tool target: {targetRow.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {toolStationEnabled && (
              <button
                type="button"
                onClick={() => setToolsOpen(true)}
                disabled={!toolRowId}
                className="px-3 py-1.5 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                title={toolRowId ? "Open station tools" : "Click a score field first to set tool target"}
              >
                Station Tools
              </button>
            )}
            <button onClick={saveAll} disabled={saveAllBusy || rows.length === 0} className="px-3 py-1.5 border rounded bg-white hover:bg-gray-50 disabled:opacity-50">
              {saveAllBusy ? "Saving..." : "Save All Changes"}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 border">ID</th>
              <th className="px-3 py-2 border">Name</th>
              <th className="px-3 py-2 border">Class</th>
              <th className="px-3 py-2 border">Score</th>
              <th className="px-3 py-2 border">Status</th>
              <th className="px-3 py-2 border w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr><td colSpan="6" className="px-3 py-4 text-center text-gray-500">Scan or load a group first.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.studentId} className="hover:bg-gray-50">
                <td className="px-3 py-2 border whitespace-nowrap">{r.sid}</td>
                <td className="px-3 py-2 border">{r.name}</td>
                <td className="px-3 py-2 border">{r.className || "-"}</td>
                <td className="px-3 py-2 border">
                  <input
                    value={r.scoreInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) => prev.map((x) => (x.studentId === r.studentId ? { ...x, scoreInput: v, dirty: true, status: "" } : x)));
                    }}
                    onFocus={() => setToolRowId(r.studentId)}
                    placeholder={inputHint(activeStation)}
                    title={inputHint(activeStation)}
                    inputMode={inputModeForStation(activeStation)}
                    className={`border rounded px-2 py-1 w-full ${toolRowId === r.studentId ? "ring-2 ring-emerald-300 border-emerald-400" : ""}`}
                  />
                </td>
                <td className="px-3 py-2 border text-xs">
                  {r.status ? <span className={r.status === "Saved" ? "text-green-700" : "text-red-600"}>{r.status}</span> : (r.existing ? `Existing: ${r.existing}` : "-")}
                </td>
                <td className="px-3 py-2 border">
                  <button onClick={() => saveOne(r)} className="px-2 py-1 border rounded hover:bg-gray-50">Save</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {scannerOpen && (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onDetected={async (raw) => {
            const parsed = parseGroupQr(raw);
            if (!parsed) {
              setError("Invalid group QR.");
              setScannerOpen(false);
              return;
            }
            if (sessionId && parsed.sessionId !== sessionId) {
              setError("Scanned group belongs to a different session.");
              setScannerOpen(false);
              return;
            }
            setSessionId(parsed.sessionId);
            setScannerOpen(false);
            await fetchGroupMembers(parsed.sessionId, parsed.groupCode);
          }}
        />
      )}

      <AnimatePresence>
        {toolsOpen && (
          <StationToolsDrawer
            open={toolsOpen}
            station={activeStation}
            targetRow={targetRow}
            onClose={() => setToolsOpen(false)}
            counterValue={counterValue}
            setCounterValue={setCounterValue}
            countdownDefault={countdownDefault}
            setCountdownDefault={setCountdownDefault}
            countdownLeft={countdownLeft}
            countdownRunning={countdownRunning}
            setCountdownRunning={setCountdownRunning}
            onResetCountdown={resetCountdown}
            stopwatchMs={stopwatchMs}
            stopwatchRunning={stopwatchRunning}
            setStopwatchRunning={(next) => {
              if (!next) {
                stopwatchBaseMsRef.current = stopwatchMs;
                setStopwatchRunning(false);
                return;
              }
              setStopwatchRunning(true);
            }}
            onResetStopwatch={() => {
              setStopwatchRunning(false);
              setStopwatchMs(0);
              stopwatchBaseMsRef.current = 0;
            }}
            formatClock={formatClock}
            formatStopwatch={formatStopwatch}
            onApplyCounter={applyCounterToScore}
            onApplyStopwatch={applyStopwatchToScore}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function inputHint(station) {
  if (station === "run") return "MSS/MMSS e.g. 930 or 1330";
  if (station === "shuttle_run") return "0.0-20.0s (1 d.p.) e.g. 10.3";
  if (station === "situps" || station === "pullups" || station === "pushups") return "0-60 reps";
  if (station === "broad_jump") return "0-300 cm";
  if (station === "sit_and_reach") return "0-80 cm";
  return "Enter valid score";
}

function inputModeForStation(station) {
  if (station === "shuttle_run") return "decimal";
  return "numeric";
}

function scoreToInput(station, row, isIppt3) {
  if (!row) return "";
  if (station === "run") {
    const v = Number(row.run_2400);
    if (!Number.isFinite(v)) return "";
    const total = Math.round(v * 60);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${mm}${String(ss).padStart(2, "0")}`;
  }
  if (station === "shuttle_run") {
    const v = Number(row.shuttle_run);
    return Number.isFinite(v) ? String(Number(v).toFixed(1)) : "";
  }
  const colMap = isIppt3
    ? { situps: "situps", pushups: "pushups" }
    : { situps: "situps", broad_jump: "broad_jump", sit_and_reach: "sit_and_reach", pullups: "pullups" };
  const col = colMap[station];
  if (!col) return "";
  const v = row[col];
  if (v == null || v === "") return "";
  return String(v);
}

function parseStationInput(station, input, isIppt3) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "Score is required." };
  const onlyInt = raw.replace(/[^0-9]/g, "");
  const inRange = (v, lo, hi) => v >= lo && v <= hi;
  if (station === "run") {
    if (!/^\d{3,4}$/.test(onlyInt)) return { ok: false, error: "Use MSS/MMSS digits." };
    const mm = onlyInt.length === 3 ? parseInt(onlyInt.slice(0, 1), 10) : parseInt(onlyInt.slice(0, 2), 10);
    const ss = parseInt(onlyInt.slice(-2), 10);
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) return { ok: false, error: "Invalid run time." };
    const minutes = mm + (ss / 60);
    return { ok: true, value: Number.parseFloat(minutes.toFixed(2)) };
  }
  if (station === "shuttle_run") {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v) || !inRange(v, 0.0, 20.0)) return { ok: false, error: "Shuttle run must be 0.0-20.0." };
    return { ok: true, value: Number.parseFloat(v.toFixed(1)) };
  }
  const n = parseInt(onlyInt, 10);
  if (!Number.isFinite(n)) return { ok: false, error: "Invalid number." };
  if (station === "situps" || station === "pullups" || station === "pushups") {
    if (!inRange(n, 0, 60)) return { ok: false, error: "Value must be 0-60." };
    return { ok: true, value: n };
  }
  if (station === "broad_jump") {
    if (!inRange(n, 0, 300)) return { ok: false, error: "Broad jump must be 0-300." };
    return { ok: true, value: n };
  }
  if (station === "sit_and_reach") {
    if (!inRange(n, 0, 80)) return { ok: false, error: "Sit & Reach must be 0-80." };
    return { ok: true, value: n };
  }
  if (isIppt3 && (station === "situps" || station === "pushups")) return { ok: true, value: n };
  return { ok: false, error: "Unsupported station." };
}

function StationToolsDrawer({
  open,
  station,
  targetRow,
  onClose,
  counterValue,
  setCounterValue,
  countdownDefault,
  setCountdownDefault,
  countdownLeft,
  countdownRunning,
  setCountdownRunning,
  onResetCountdown,
  stopwatchMs,
  stopwatchRunning,
  setStopwatchRunning,
  onResetStopwatch,
  formatClock,
  formatStopwatch,
  onApplyCounter,
  onApplyStopwatch,
}) {
  const [filledNotice, setFilledNotice] = useState(false);
  const [timerFilledNotice, setTimerFilledNotice] = useState("");
  const [endedNotice, setEndedNotice] = useState(false);

  useEffect(() => {
    if (countdownLeft === 0 && !countdownRunning) {
      setEndedNotice(true);
      return;
    }
    setEndedNotice(false);
  }, [countdownLeft, countdownRunning]);

  if (!open) return null;
  const isCountStation = station === "situps" || station === "pullups" || station === "pushups";
  const isShuttleStation = station === "shuttle_run";
  const counterLabel = station === "pullups" ? "Pull-up Count" : station === "pushups" ? "Push-up Count" : "Sit-up Count";
  const counterCap = station === "pullups" ? 30 : 60;

  return (
    <div className="fixed inset-0 z-[60]" aria-hidden={!open}>
      <motion.div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="absolute top-0 right-0 h-full w-full max-w-sm bg-white shadow-xl border-l p-4 space-y-4 overflow-y-auto"
        initial={{ x: 360 }}
        animate={{ x: 0 }}
        exit={{ x: 360 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Station Tools</h3>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200" aria-label="Close station tools">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-sm text-slate-700">
          <span className="font-medium">Target:</span>{" "}
          {targetRow ? `${targetRow.name} (${targetRow.sid})` : "Select a row by clicking into a score field."}
        </div>
        {isCountStation && (
          <>
            <div className="space-y-2">
              <div className="text-sm font-medium">{station === "pullups" ? "Countdown (30s default)" : "Countdown (60s default)"}</div>
              <div className="text-3xl font-mono tracking-wide">{formatClock(countdownLeft)}</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={120}
                  step={1}
                  value={countdownDefault}
                  onChange={(e) => {
                    const next = Math.max(5, Math.min(120, parseInt(e.target.value || "0", 10) || 0));
                    setCountdownDefault(next);
                  }}
                  className="border rounded px-2 py-1 w-24"
                  aria-label="Countdown default seconds"
                />
                <span className="text-xs text-gray-600">seconds default</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCountdownRunning(!countdownRunning)}
                  className={(countdownRunning
                    ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600"
                    : "bg-green-600 hover:bg-green-700 text-white border-green-700") + " px-4 py-2 border rounded font-medium"}
                >
                  {countdownRunning ? "Pause" : "Start"}
                </button>
                <button type="button" onClick={onResetCountdown} className="px-4 py-2 border rounded border-red-300 text-red-700 hover:bg-red-50 font-medium">Reset</button>
                <button
                  type="button"
                  onClick={() => {
                    setCountdownRunning(false);
                    onResetCountdown();
                  }}
                  className="px-4 py-2 border rounded border-slate-300 text-slate-700 hover:bg-slate-100 font-medium"
                >
                  Set Default
                </button>
              </div>
              {endedNotice && (
                <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  Countdown complete.
                </div>
              )}
            </div>

            <div className="border-t pt-4 space-y-2">
              <div className="text-sm font-medium">{counterLabel}</div>
              <div className="text-3xl font-mono tracking-wide">{counterValue}</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setCounterValue((v) => Math.max(0, v - 1))} className="px-5 py-3 text-lg border rounded bg-orange-500 hover:bg-orange-600 text-white border-orange-600 font-semibold min-w-[92px]">-1</button>
                <button type="button" onClick={() => setCounterValue((v) => Math.min(counterCap, v + 1))} className="px-5 py-3 text-lg border rounded bg-green-600 hover:bg-green-700 text-white border-green-700 font-semibold min-w-[92px]">+1</button>
                <button type="button" onClick={() => setCounterValue(0)} className="px-4 py-2 border rounded border-red-300 text-red-700 hover:bg-red-50 font-medium">Reset</button>
              </div>
              <button
                type="button"
                disabled={!targetRow}
                onClick={() => {
                  onApplyCounter();
                  setFilledNotice(true);
                  setTimeout(() => setFilledNotice(false), 1500);
                }}
                className="w-full px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                Fill Score Entry
              </button>
              {filledNotice && <div className="text-sm text-green-700">Score entry filled</div>}
            </div>
          </>
        )}
        {isShuttleStation && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Stopwatch</div>
            <div className="text-3xl font-mono tracking-wide">{formatStopwatch(stopwatchMs)}s</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStopwatchRunning(!stopwatchRunning)}
                className={(stopwatchRunning
                  ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600"
                  : "bg-green-600 hover:bg-green-700 text-white border-green-700") + " px-4 py-2 border rounded font-medium"}
              >
                {stopwatchRunning ? "Pause" : "Start"}
              </button>
              <button type="button" onClick={onResetStopwatch} className="px-4 py-2 border rounded border-red-300 text-red-700 hover:bg-red-50 font-medium">Reset</button>
            </div>
            <button
              type="button"
              disabled={!targetRow}
              onClick={() => {
                onApplyStopwatch();
                setTimerFilledNotice("Score entry filled");
                setTimeout(() => setTimerFilledNotice(""), 1500);
              }}
              className="px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
            >
              Fill Score Entry
            </button>
            {timerFilledNotice && <div className="text-sm text-green-700">{timerFilledNotice}</div>}
          </div>
        )}
      </motion.aside>
    </div>
  );
}

function ScannerModal({ onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const controlsRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const [supported, setSupported] = useState(true);
  const [err, setErr] = useState("");
  const [facingMode, setFacingMode] = useState("user");
  const [preferredDeviceId, setPreferredDeviceId] = useState("");
  const [activeCameraLabel, setActiveCameraLabel] = useState("");
  const [activeCameraId, setActiveCameraId] = useState("");
  const [debugError, setDebugError] = useState("");
  const [lastTriedMode, setLastTriedMode] = useState("user");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const stopActiveMedia = () => {
    if (controlsRef.current) {
      try { controlsRef.current.stop(); } catch {}
      controlsRef.current = null;
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch {}
    }
  };

  const pickDeviceForMode = (devices, mode, currentId) => {
    if (!Array.isArray(devices) || devices.length === 0) return null;
    const list = devices.filter((d) => d && d.kind === "videoinput");
    if (!list.length) return null;
    const norm = (s) => String(s || "").toLowerCase();
    const backWords = ["back", "rear", "environment", "world"];
    const frontWords = ["front", "user", "facetime"];
    const wanted = mode === "user" ? frontWords : backWords;
    const match = list.find((d) => wanted.some((w) => norm(d.label).includes(w)));
    if (match) return match;
    const other = list.find((d) => d.deviceId && d.deviceId !== currentId);
    if (other) return other;
    return list[0];
  };

  useEffect(() => {
    let cleanupFn = null;
    const hasBarcode = "BarcodeDetector" in window;
    let cancelled = false;
    const start = async () => {
      try {
        setErr("");
        setDebugError("");
        setLastTriedMode(facingMode);
        stopActiveMedia();
        // iOS Safari can throw AbortError when switching camera too quickly.
        await new Promise((resolve) => setTimeout(resolve, 120));
        const candidates = [];
        candidates.push({ facingMode: { exact: facingMode } });
        candidates.push({ facingMode });
        if (preferredDeviceId) candidates.push({ deviceId: { exact: preferredDeviceId } });
        candidates.push(true);
        let stream = null;
        const candidateErrors = [];
        for (const video of candidates) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video });
            break;
          } catch (openErr) {
            const hint = typeof video === "boolean"
              ? "default"
              : (video?.deviceId ? "deviceId" : (video?.facingMode ? "facingMode" : "video"));
            const msg = `${hint}: ${openErr?.name || "Error"} ${openErr?.message || ""}`.trim();
            candidateErrors.push(msg);
          }
        }
        if (!stream) throw new Error(candidateErrors.join(" | ") || "Camera unavailable.");
        if (cancelled) {
          try { stream.getTracks().forEach((t) => t.stop()); } catch {}
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        try {
          const track = stream.getVideoTracks?.()[0];
          const activeId = track?.getSettings?.()?.deviceId;
          setActiveCameraLabel(track?.label || "");
          setActiveCameraId(activeId || "");
          if (activeId) setPreferredDeviceId(activeId);
        } catch {}
        if (hasBarcode) {
          setSupported(true);
          const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39"] });
          const tick = async () => {
            if (cancelled) return;
            try {
              const frame = await detector.detect(videoRef.current);
              if (frame && frame.length > 0) {
                const value = frame[0].rawValue;
                if (value) onDetectedRef.current?.(value);
                return;
              }
            } catch {}
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          cleanupFn = () => { cancelled = true; };
        } else {
          try {
            const { BrowserMultiFormatReader } = await import("@zxing/browser");
            setSupported(true);
            const codeReader = new BrowserMultiFormatReader();
            const controls = await codeReader.decodeFromVideoDevice(null, videoRef.current, (result, _err, c) => {
              if (result) {
                const v = result.getText();
                if (v) {
                  c.stop();
                  onDetectedRef.current?.(v);
                }
              }
            });
            controlsRef.current = controls;
            cleanupFn = () => { try { controls.stop(); codeReader.reset(); } catch {} };
          } catch {
            setSupported(false);
          }
        }
      } catch (e) {
        const full = `${e?.name || "Error"}: ${e?.message || "Camera unavailable."}`;
        setErr(e?.message || "Camera unavailable.");
        setDebugError(full);
      }
    };
    start();
    return () => {
      cancelled = true;
      stopActiveMedia();
      if (typeof cleanupFn === "function") cleanupFn();
    };
  }, [facingMode]);

  const handleSwitchCamera = async () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const target = pickDeviceForMode(devices, nextMode, activeCameraId || preferredDeviceId);
        if (target?.deviceId) setPreferredDeviceId(target.deviceId);
      }
    } catch {}
    setFacingMode(nextMode);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-medium">Scan Group QR</div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close scanner">X</button>
        </div>
        <div className="p-3 space-y-2">
          {supported ? (
            <div className="aspect-video bg-black rounded overflow-hidden">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            </div>
          ) : (
            <div className="text-sm text-gray-600">Browser does not support in-page barcode scanning. Use Chrome/Edge.</div>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="text-xs text-gray-500">Tip: Point the camera at the group QR.</div>
          <div className="text-[11px] text-slate-600 border rounded bg-slate-50 p-2 break-all">
            <div><span className="font-medium">Debug marker:</span> 1135H</div>
            <div><span className="font-medium">Debug mode:</span> {lastTriedMode}</div>
            <div><span className="font-medium">Active camera:</span> {activeCameraLabel || "-"}</div>
            <div><span className="font-medium">Device ID:</span> {activeCameraId || "-"}</div>
            <div><span className="font-medium">Last media error:</span> {debugError || "-"}</div>
          </div>
        </div>
        <div className="px-3 py-2 border-t flex items-center justify-between gap-2">
          <button type="button" onClick={handleSwitchCamera} className="px-3 py-1.5 border rounded hover:bg-gray-50">Switch Camera</button>
          <button onClick={onClose} className="px-3 py-1.5 border rounded hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}

function Timer(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="13" r="9" />
      <path d="M12 7v6l4 2" />
      <path d="M10 2h4" />
    </svg>
  );
}

function Camera(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function X(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
