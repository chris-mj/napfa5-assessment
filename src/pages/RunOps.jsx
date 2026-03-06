import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";

function formatWhen(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function shortId(value) {
  if (!value) return "-";
  const s = String(value);
  return s.length > 20 ? `${s.slice(0, 8)}...${s.slice(-6)}` : s;
}

export default function RunOps({ user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [schools, setSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState("");

  const [sessionId, setSessionId] = useState("");
  const [runConfigId, setRunConfigId] = useState("");
  const [stationId, setStationId] = useState("");
  const [eventType, setEventType] = useState("");
  const [lookbackHours, setLookbackHours] = useState("24");
  const owner = isPlatformOwner(user);

  useEffect(() => {
    let ignore = false;
    const loadSchools = async () => {
      try {
        if (!user?.id) {
          if (!ignore) setSchools([]);
          return;
        }
        if (owner) {
          const { data, error: schoolError } = await supabase
            .from("schools")
            .select("id, name")
            .order("name");
          if (schoolError) throw schoolError;
          if (!ignore) {
            setSchools(data || []);
            setSelectedSchool("");
          }
          return;
        }
        const { data, error: membershipError } = await supabase
          .from("memberships")
          .select("school_id, schools!inner(id, name)")
          .eq("user_id", user.id)
          .in("role", ["admin", "superadmin"]);
        if (membershipError) throw membershipError;
        const opts = (data || []).map((row) => ({ id: row.school_id, name: row.schools?.name || row.school_id }));
        if (!ignore) {
          setSchools(opts);
          setSelectedSchool((prev) => prev || opts[0]?.id || "");
        }
      } catch (e) {
        if (!ignore) {
          setSchools([]);
          setError(e?.message || "Failed to load schools.");
        }
      }
    };
    loadSchools();
    return () => {
      ignore = true;
    };
  }, [owner, user?.id]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      let sessionIds = null;
      if (selectedSchool) {
        const { data: sessions, error: sessionError } = await supabase
          .from("sessions")
          .select("id")
          .eq("school_id", selectedSchool)
          .limit(2000);
        if (sessionError) throw sessionError;
        sessionIds = (sessions || []).map((s) => s.id).filter(Boolean);
        if (sessionIds.length === 0) {
          setRows([]);
          setLoading(false);
          return;
        }
      }

      let query = supabase
        .from("run_events")
        .select("event_id, run_config_id, session_id, station_id, event_type, occurred_at, created_at, payload")
        .order("occurred_at", { ascending: false })
        .limit(500);

      if (sessionId.trim()) query = query.eq("session_id", sessionId.trim());
      if (runConfigId.trim()) query = query.eq("run_config_id", runConfigId.trim());
      if (stationId.trim()) query = query.eq("station_id", stationId.trim());
      if (eventType.trim()) query = query.eq("event_type", eventType.trim());
      if (sessionIds) query = query.in("session_id", sessionIds);

      const hours = Number(lookbackHours);
      if (Number.isFinite(hours) && hours > 0) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        query = query.gte("occurred_at", since);
      }

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      setRows(data || []);
    } catch (e) {
      setError(e?.message || "Failed to load run events.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchool]);

  const summary = useMemo(() => {
    const uniqueRunners = new Set();
    const eventTypeCounts = {};
    for (const row of rows) {
      const rid = row?.payload?.runner_id;
      if (rid) uniqueRunners.add(String(rid));
      const type = row?.event_type || "unknown";
      eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
    }
    const latest = rows.length ? rows[0].occurred_at : null;
    const ageMs = latest ? Date.now() - new Date(latest).getTime() : null;
    const stale = typeof ageMs === "number" && ageMs > 5 * 60 * 1000;

    return {
      total: rows.length,
      uniqueRunners: uniqueRunners.size,
      latest,
      stale,
      eventTypeCounts
    };
  }, [rows]);

  const typeEntries = useMemo(
    () => Object.entries(summary.eventTypeCounts).sort((a, b) => b[1] - a[1]),
    [summary.eventTypeCounts]
  );

  return (
    <main className="w-full">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">Run Ops</h1>
          <p className="text-sm text-gray-600">Operational view over run station event ingestion.</p>
        </header>

        <section className="bg-white border rounded-lg p-3 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
            <select
              className="text-sm border rounded px-2 py-1 bg-white"
              value={selectedSchool}
              onChange={(e) => setSelectedSchool(e.target.value)}
            >
              {owner && <option value="">All schools</option>}
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
            <input
              className="text-sm border rounded px-2 py-1 bg-white"
              placeholder="session_id"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
            <input
              className="text-sm border rounded px-2 py-1 bg-white"
              placeholder="run_config_id"
              value={runConfigId}
              onChange={(e) => setRunConfigId(e.target.value)}
            />
            <input
              className="text-sm border rounded px-2 py-1 bg-white"
              placeholder="station_id"
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
            />
            <input
              className="text-sm border rounded px-2 py-1 bg-white"
              placeholder="event_type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            />
            <input
              className="text-sm border rounded px-2 py-1 bg-white"
              placeholder="lookback hours"
              value={lookbackHours}
              onChange={(e) => setLookbackHours(e.target.value)}
            />
            <button onClick={load} className="text-sm px-3 py-1.5 border rounded bg-white hover:bg-gray-50">
              Refresh
            </button>
          </div>
        </section>

        {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{error}</div>}

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="border rounded p-3 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Events</div>
            <div className="text-2xl font-semibold">{loading ? "..." : summary.total}</div>
          </div>
          <div className="border rounded p-3 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Unique runners</div>
            <div className="text-2xl font-semibold">{loading ? "..." : summary.uniqueRunners}</div>
          </div>
          <div className="border rounded p-3 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Latest event</div>
            <div className="text-sm font-medium">{loading ? "..." : formatWhen(summary.latest)}</div>
          </div>
          <div className="border rounded p-3 bg-white shadow-sm">
            <div className="text-xs text-gray-500">Stream status</div>
            <div className={`text-sm font-semibold ${summary.stale ? "text-amber-700" : "text-emerald-700"}`}>
              {loading ? "..." : summary.latest ? (summary.stale ? "Stale" : "Healthy") : "No data"}
            </div>
          </div>
        </section>

        <section className="bg-white border rounded-lg shadow-sm p-3">
          <h2 className="text-sm font-semibold mb-2">Event Types</h2>
          <div className="flex flex-wrap gap-2">
            {typeEntries.length === 0 && <span className="text-sm text-gray-500">No events</span>}
            {typeEntries.map(([type, count]) => (
              <span key={type} className="inline-flex items-center px-2 py-1 rounded border bg-gray-50 text-xs text-gray-700">
                {type}: {count}
              </span>
            ))}
          </div>
        </section>

        <section className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2 border">Occurred</th>
                <th className="px-3 py-2 border">Session</th>
                <th className="px-3 py-2 border">Run Config</th>
                <th className="px-3 py-2 border">Station</th>
                <th className="px-3 py-2 border">Type</th>
                <th className="px-3 py-2 border">Runner</th>
                <th className="px-3 py-2 border">Event ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-3 py-6 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-3 py-6 text-center text-gray-500">
                    No events
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.event_id}>
                    <td className="px-3 py-2 border whitespace-nowrap">{formatWhen(row.occurred_at)}</td>
                    <td className="px-3 py-2 border">{shortId(row.session_id)}</td>
                    <td className="px-3 py-2 border">{shortId(row.run_config_id)}</td>
                    <td className="px-3 py-2 border">{row.station_id || "-"}</td>
                    <td className="px-3 py-2 border">{row.event_type || "-"}</td>
                    <td className="px-3 py-2 border">{row.payload?.runner_id || "-"}</td>
                    <td className="px-3 py-2 border">{shortId(row.event_id)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
