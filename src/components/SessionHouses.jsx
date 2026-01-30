import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { normalizeStudentId } from "../utils/ids";

export default function SessionHouses({ session, membership, canManage }) {
  const sessionId = session?.id;
  const schoolId = membership?.school_id;
  const sessionYear = useMemo(() => {
    try {
      return session?.session_date ? new Date(session.session_date).getFullYear() : new Date().getFullYear();
    } catch {
      return new Date().getFullYear();
    }
  }, [session?.session_date]);

  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [houseOptions, setHouseOptions] = useState([]);
  const [bulkHouse, setBulkHouse] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [filterClass, setFilterClass] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterHouse, setFilterHouse] = useState("");
  const [sortBy, setSortBy] = useState("class");
  const [sortBy2, setSortBy2] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const houseFileRef = useRef(null);

  const loadData = async () => {
    if (!sessionId || !schoolId) return;
    setLoading(true);
    setMessage("");
    try {
      const { data: rosterRows, error: rErr } = await supabase
        .from("session_roster")
        .select("student_id, house, students!inner(id, student_identifier, name, gender, enrollments!left(class, academic_year, is_active, school_id))")
        .eq("session_id", sessionId);
      if (rErr) throw rErr;
      const list = (rosterRows || []).map(r => {
        const s = r.students || {};
        const ens = Array.isArray(s.enrollments) ? s.enrollments : [];
        let cls = "";
        if (sessionYear) {
          const m = ens.find(e => e && e.school_id === schoolId && e.academic_year === sessionYear && e.is_active);
          cls = m?.class || "";
        }
        if (!cls && ens.length) {
          const sorted = [...ens].sort((a,b)=> (b.academic_year||0)-(a.academic_year||0));
          cls = sorted[0]?.class || "";
        }
        return {
          id: s.id,
          student_identifier: s.student_identifier,
          name: s.name,
          gender: s.gender,
          class: cls,
          house: r.house || ""
        };
      });
      list.sort((a,b)=> String(a.class||'').localeCompare(String(b.class||'')) || String(a.name||'').localeCompare(String(b.name||'')));
      setRoster(list);
      setHouseOptions(Array.from(new Set(list.map(r => String(r.house || '').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b)));
      setSelected(new Set());
    } catch (e) {
      setMessage(e.message || "Failed to load session roster.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [sessionId, schoolId, sessionYear]);

  const filtered = useMemo(() => {
    const q = (filterQuery || "").trim().toLowerCase();
    const cls = (filterClass || "").trim().toLowerCase();
    const gen = (filterGender || "").trim().toLowerCase();
    const house = (filterHouse || "").trim().toLowerCase();
    return (roster || []).filter(r => {
      const matchClass = !cls || String(r.class || "").toLowerCase().includes(cls);
      const matchGender = !gen || String(r.gender || "").toLowerCase().startsWith(gen);
      const matchHouse = !house || String(r.house || "").toLowerCase().includes(house);
      if (!q) return matchClass && matchGender && matchHouse;
      const hay = `${r.student_identifier || ''} ${r.name || ''} ${r.class || ''} ${r.house || ''}`.toLowerCase();
      return matchClass && matchGender && matchHouse && hay.includes(q);
    });
  }, [roster, filterClass, filterQuery, filterGender, filterHouse]);

  const sorted = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    const getVal = (r, key) => {
      if (key === "class") return String(r.class || "");
      if (key === "gender") return String(r.gender || "");
      if (key === "house") return String(r.house || "");
      return String(r.name || "");
    };
    const primary = (r) => getVal(r, sortBy);
    const secondary = (r) => getVal(r, sortBy2);
    return [...filtered].sort((a, b) => {
      const av = primary(a);
      const bv = primary(b);
      const primaryCmp = av.localeCompare(bv) * dir;
      if (primaryCmp !== 0) return primaryCmp;
      const sv = secondary(a);
      const tv = secondary(b);
      const secondaryCmp = sv.localeCompare(tv) * dir;
      if (secondaryCmp !== 0) return secondaryCmp;
      return String(a.name || "").localeCompare(String(b.name || "")) * dir;
    });
  }, [filtered, sortBy, sortBy2, sortDir]);

  const classOptions = useMemo(() => {
    const set = new Set((roster || []).map(r => r.class).filter(Boolean));
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }, [roster]);

  const toggleSelected = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = (checked) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) filtered.forEach(r => next.add(r.id));
      else filtered.forEach(r => next.delete(r.id));
      return next;
    });
  };

  const updateHouse = async (studentId, house) => {
    if (!canManage) return;
    const value = (house || "").trim();
    try {
      setMessage("");
      const { error } = await supabase
        .from("session_roster")
        .update({ house: value || null })
        .match({ session_id: sessionId, student_id: studentId });
      if (error) throw error;
      setRoster(prev => prev.map(r => (r.id === studentId ? { ...r, house: value } : r)));
      if (value) {
        setHouseOptions(prev => Array.from(new Set([...prev, value])).sort((a,b)=>a.localeCompare(b)));
      }
    } catch (e) {
      setMessage(e.message || "Failed to update house.");
    }
  };

  const applyBulkHouse = async () => {
    if (!canManage) return;
    const value = (bulkHouse || "").trim();
    const ids = Array.from(selected);
    if (!value || !ids.length) return;
    setLoading(true);
    setMessage("");
    try {
      const payload = ids.map(id => ({ session_id: sessionId, student_id: id, house: value }));
      const { error } = await supabase.from("session_roster").upsert(payload, { onConflict: "session_id,student_id" });
      if (error) throw error;
      setRoster(prev => prev.map(r => (ids.includes(r.id) ? { ...r, house: value } : r)));
      setHouseOptions(prev => Array.from(new Set([...prev, value])).sort((a,b)=>a.localeCompare(b)));
      setMessage(`Updated house for ${ids.length} student(s).`);
    } catch (e) {
      setMessage(e.message || "Failed to update houses.");
    } finally {
      setLoading(false);
    }
  };

  const clearBulkHouse = async () => {
    if (!canManage) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    setLoading(true);
    setMessage("");
    try {
      const payload = ids.map(id => ({ session_id: sessionId, student_id: id, house: null }));
      const { error } = await supabase.from("session_roster").upsert(payload, { onConflict: "session_id,student_id" });
      if (error) throw error;
      setRoster(prev => prev.map(r => (ids.includes(r.id) ? { ...r, house: "" } : r)));
      setHouseOptions(prev => {
        const remaining = new Set();
        (roster || []).forEach(r => {
          if (!ids.includes(r.id) && r.house) remaining.add(r.house);
        });
        return Array.from(remaining).sort((a,b)=>a.localeCompare(b));
      });
      setMessage(`Cleared house for ${ids.length} student(s).`);
    } catch (e) {
      setMessage(e.message || "Failed to clear houses.");
    } finally {
      setLoading(false);
    }
  };

  const deleteHouse = async (houseName) => {
    if (!canManage || !houseName) return;
    const ok = window.confirm(`Remove house "${houseName}" from all students in this session?`);
    if (!ok) return;
    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase
        .from("session_roster")
        .update({ house: null })
        .match({ session_id: sessionId, house: houseName });
      if (error) throw error;
      setRoster(prev => prev.map(r => (r.house === houseName ? { ...r, house: "" } : r)));
      setHouseOptions(prev => prev.filter(h => h !== houseName));
      if (bulkHouse === houseName) setBulkHouse("");
      setMessage(`Deleted house "${houseName}".`);
    } catch (e) {
      setMessage(e.message || "Failed to delete house.");
    } finally {
      setLoading(false);
    }
  };

  const promptNewHouse = () => {
    const name = window.prompt("Enter new house name");
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    setHouseOptions(prev => Array.from(new Set([...prev, trimmed])).sort((a,b)=>a.localeCompare(b)));
    return trimmed;
  };

  const downloadHouseTemplate = () => {
    const header = ["Student ID","Name","Class","Gender","House"].map(csvCell).join(",");
    const content = header + "\n";
    downloadCsv(content, `house_template_${sessionYear}.csv`);
  };

  const downloadHouseRoster = () => {
    const header = ["Student ID","Name","Class","Gender","House"].map(csvCell).join(",");
    const rows = (roster || []).map(r => ([
      normalizeStudentId(r.student_identifier),
      r.name || "",
      r.class || "",
      r.gender || "",
      r.house || ""
    ].map(csvCell).join(",")));
    const content = [header, ...rows].join("\n") + "\n";
    downloadCsv(content, `house_roster_${sessionYear}.csv`);
  };

  const onHouseCsvUpload = async (file) => {
    if (!file || !sessionId) return;
    setLoading(true);
    setMessage("");
    try {
      const text = await file.text();
      const parsed = parseHouseCsv(text);
      if (parsed.error) {
        setMessage(parsed.error);
        return;
      }
      const rosterById = new Map((roster || []).map(r => [String(normalizeStudentId(r.student_identifier || "")).toUpperCase(), r]));
      const updates = [];
      const errors = [];
      parsed.rows.forEach((row) => {
        const sid = String(row.studentId || "").toUpperCase();
        if (!sid) return;
        const match = rosterById.get(sid);
        if (!match) {
          errors.push(`Row ${row.row}: student not in roster (${sid}).`);
          return;
        }
        const house = (row.house || "").trim();
        updates.push({ session_id: sessionId, student_id: match.id, house: house || null });
      });
      if (!updates.length) {
        setMessage(errors.length ? errors.slice(0, 5).join(" ") : "No valid rows found.");
        return;
      }
      const { error } = await supabase.from("session_roster").upsert(updates, { onConflict: "session_id,student_id" });
      if (error) throw error;
      await loadData();
      const note = errors.length ? `Completed with ${errors.length} warning(s).` : "Upload complete.";
      setMessage(`Updated ${updates.length} student(s). ${note}`);
    } catch (e) {
      setMessage(e.message || "Failed to import houses.");
    } finally {
      setLoading(false);
      if (houseFileRef.current) houseFileRef.current.value = "";
    }
  };

  return (
    <section className="space-y-3">
      <div className="border rounded-lg bg-white p-3 flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button onClick={downloadHouseTemplate} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50">Download House Template</button>
          <button onClick={downloadHouseRoster} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50">Download House List</button>
          {canManage && (
            <>
              <button onClick={() => houseFileRef.current?.click()} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50">Upload House CSV</button>
              <input ref={houseFileRef} type="file" accept=".csv,text/csv" onChange={(e) => onHouseCsvUpload(e.target.files?.[0])} className="hidden" />
            </>
          )}
        </div>
      </div>

      {canManage && (
        <div className="border rounded-lg bg-white p-3 flex items-center flex-wrap gap-2">
          <label className="text-sm text-gray-600">Set house for selected</label>
          <select
            className="border rounded px-2 py-1 text-sm bg-white"
            value={bulkHouse}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "__new__") {
                const created = promptNewHouse();
                setBulkHouse(created || "");
              } else {
                setBulkHouse(val);
              }
            }}
          >
            <option value="">Select house</option>
            {houseOptions.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
            <option value="__new__">Add new...</option>
          </select>
          <button onClick={applyBulkHouse} disabled={!bulkHouse || selected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Apply</button>
          <button onClick={clearBulkHouse} disabled={selected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Clear</button>
        </div>
      )}

      {canManage && houseOptions.length > 0 && (
        <div className="border rounded-lg bg-white p-3">
          <div className="text-sm font-medium text-gray-700 mb-2">Houses</div>
          <div className="flex flex-wrap gap-2">
            {houseOptions.map(h => (
              <div key={h} className="flex items-center gap-2 border rounded px-2 py-1 bg-white">
                <span className="text-sm">{h}</span>
                <button onClick={() => deleteHouse(h)} className="text-xs px-2 py-0.5 border rounded hover:bg-gray-50">Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-white overflow-x-auto">
        <div className="p-2 border-b bg-white grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <label className="text-gray-600">Search</label>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Name or ID"
              className="border rounded px-2 py-1 bg-white w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600">Class</label>
            <select className="border rounded px-2 py-1 bg-white w-full" value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
              <option value="">All</option>
              {classOptions.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600">Gender</label>
            <select className="border rounded px-2 py-1 bg-white w-full" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
              <option value="">All</option>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600">House</label>
            <select className="border rounded px-2 py-1 bg-white w-full" value={filterHouse} onChange={(e) => setFilterHouse(e.target.value)}>
              <option value="">All</option>
              {houseOptions.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600">Sort</label>
            <select className="border rounded px-2 py-1 bg-white w-full" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">Name</option>
              <option value="class">Class</option>
              <option value="gender">Gender</option>
              <option value="house">House</option>
            </select>
            <select className="border rounded px-2 py-1 bg-white w-full" value={sortBy2} onChange={(e) => setSortBy2(e.target.value)}>
              <option value="name">Then Name</option>
              <option value="class">Then Class</option>
              <option value="gender">Then Gender</option>
              <option value="house">Then House</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir(d => (d === "asc" ? "desc" : "asc"))}
              className="px-2 py-1 border rounded text-xs bg-white hover:bg-gray-50"
              aria-label="Toggle sort direction"
            >
              {sortDir === "asc" ? "A-Z" : "Z-A"}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 border w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))}
                  onChange={(e) => toggleAllFiltered(e.target.checked)}
                />
              </th>
              <th className="px-3 py-2 border">ID</th>
              <th className="px-3 py-2 border">Name</th>
              <th className="px-3 py-2 border">Class</th>
              <th className="px-3 py-2 border">Gender</th>
              <th className="px-3 py-2 border">House</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan="6" className="px-3 py-4 text-center text-gray-500">No students in roster.</td></tr>
            ) : sorted.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 border">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                </td>
                <td className="px-3 py-2 border whitespace-nowrap">{normalizeStudentId(s.student_identifier)}</td>
                <td className="px-3 py-2 border">{s.name}</td>
                <td className="px-3 py-2 border">{s.class || ""}</td>
                <td className="px-3 py-2 border">{s.gender || ""}</td>
                <td className="px-3 py-2 border">
                  {canManage ? (
                    <select
                      className="border rounded px-2 py-1 text-sm bg-white"
                      value={s.house || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__new__") {
                          const created = promptNewHouse();
                          if (created) updateHouse(s.id, created);
                        } else {
                          updateHouse(s.id, val);
                        }
                      }}
                    >
                      <option value="">Unassigned</option>
                      {houseOptions.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                      <option value="__new__">Add new...</option>
                    </select>
                  ) : (
                    <span>{s.house || "-"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && <div className="text-sm text-gray-700">{message}</div>}
    </section>
  );
}

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur.trim());
  return out;
}

function parseHouseCsv(csvText) {
  const lines = String(csvText).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map(c => c.toLowerCase());
    if (cols.some(c => c.includes("house")) && cols.some(c => c.includes("id"))) {
      headerIdx = i;
      break;
    }
  }
  const headers = splitCsvLine(lines[headerIdx]).map(c => c.trim().toLowerCase());
  const idxId = headers.findIndex(h => h.includes("student id") || h === "id" || h.includes("studentid"));
  const idxName = headers.findIndex(h => h.includes("name"));
  const idxClass = headers.findIndex(h => h.includes("class"));
  const idxGender = headers.findIndex(h => h.includes("gender"));
  const idxHouse = headers.findIndex(h => h.includes("house"));
  if (idxId < 0 || idxHouse < 0) {
    return { rows: [], headerIndex: headerIdx, error: "Missing required columns: Student ID and House." };
  }
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = splitCsvLine(raw);
    const rowNum = i + 1;
    const studentId = idxId >= 0 ? normalizeStudentId(cols[idxId] || "") : "";
    const name = idxName >= 0 ? (cols[idxName] || "").trim() : "";
    const klass = idxClass >= 0 ? (cols[idxClass] || "").trim() : "";
    const gender = idxGender >= 0 ? (cols[idxGender] || "").trim() : "";
    const house = idxHouse >= 0 ? (cols[idxHouse] || "").trim() : "";
    rows.push({ row: rowNum, studentId, name, klass, gender, house });
  }
  return { rows, headerIndex: headerIdx };
}
