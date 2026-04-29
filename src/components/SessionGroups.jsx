import { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { jsPDF } from "jspdf";
import { supabase } from "../lib/supabaseClient";
import { fetchSessionRosterWithStudents } from "../lib/sessionRoster";
import { normalizeStudentId } from "../utils/ids";
import { drawQrDataUrl } from "../utils/qrcode";
import { encodeGroupQr } from "../utils/groupQr";

export default function SessionGroups({ session, membership, canManage }) {
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
  const [groups, setGroups] = useState([]);
  const [memberMap, setMemberMap] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageArea, setMessageArea] = useState("global");
  const [selected, setSelected] = useState(new Set());
  const [filterQuery, setFilterQuery] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [autoByClass, setAutoByClass] = useState(true);
  const [autoByGender, setAutoByGender] = useState(false);
  const [autoSize, setAutoSize] = useState(10);
  const [autoSizeInput, setAutoSizeInput] = useState("10");
  const [autoAssignNotice, setAutoAssignNotice] = useState("");
  const groupFileRef = useRef(null);
  const workflowInitializedRef = useRef(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupCodeDraft, setGroupCodeDraft] = useState("");
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupModalTarget, setGroupModalTarget] = useState("create");
  const [confirmState, setConfirmState] = useState({
    open: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    tone: "danger",
    action: null,
    groupId: null,
  });
  const [openSections, setOpenSections] = useState({
    setup: true,
    assign: false,
  });
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const showMessage = (area, text) => {
    setMessageArea(area);
    setMessage(text);
  };

  const loadData = useCallback(async () => {
    if (!sessionId || !schoolId) return;
    setLoading(true);
    setMessage("");
    try {
      const [{ data: rosterRows, error: rosterErr }, { data: grpRows, error: grpErr }, { data: mRows, error: memErr }] = await Promise.all([
        fetchSessionRosterWithStudents(supabase, sessionId, {
          schoolId,
          sessionYear,
          studentFields: ["id", "student_identifier", "name", "gender"],
        }).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error })),
        supabase
          .from("session_groups")
          .select("id, session_id, group_code, group_name")
          .eq("session_id", sessionId)
          .order("group_code", { ascending: true }),
        supabase
          .from("session_group_members")
          .select("student_id, session_group_id")
          .eq("session_id", sessionId),
      ]);
      if (rosterErr) throw rosterErr;
      if (grpErr) throw grpErr;
      if (memErr) throw memErr;

      const list = (rosterRows || []).map((r) => {
        const s = r.students || {};
        return {
          id: s.id,
          student_identifier: s.student_identifier,
          name: s.name,
          class: r.class || "",
          gender: s.gender || "",
        };
      });
      list.sort((a, b) => String(a.class || "").localeCompare(String(b.class || "")) || String(a.name || "").localeCompare(String(b.name || "")));
      setRoster(list);
      setGroups(grpRows || []);
      if (!workflowInitializedRef.current) {
        const hasGroups = (grpRows || []).length > 0;
        setOpenSections({ setup: !hasGroups, assign: hasGroups });
        workflowInitializedRef.current = true;
      }
      const nextMap = new Map();
      ;(mRows || []).forEach((r) => nextMap.set(r.student_id, r.session_group_id));
      setMemberMap(nextMap);
      setSelected(new Set());
    } catch (e) {
      showMessage("global", e.message || "Failed to load groups.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, sessionId, sessionYear]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const classOptions = useMemo(() => {
    const set = new Set((roster || []).map((r) => r.class).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [roster]);

  const groupById = useMemo(() => {
    const m = new Map();
    (groups || []).forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);

  const groupedCounts = useMemo(() => {
    const out = new Map();
    memberMap.forEach((gid) => out.set(gid, (out.get(gid) || 0) + 1));
    return out;
  }, [memberMap]);
  const assignedCount = useMemo(
    () => (roster || []).reduce((acc, r) => acc + (memberMap.has(r.id) ? 1 : 0), 0),
    [roster, memberMap]
  );
  const unassignedCount = Math.max(0, (roster || []).length - assignedCount);

  const toggleSection = (key) => {
    setOpenSections((prev) => ({
      setup: false,
      assign: false,
      [key]: !prev[key],
    }));
  };

  const filtered = useMemo(() => {
    const q = String(filterQuery || "").trim().toLowerCase();
    return (roster || []).filter((r) => {
      if (filterClass && String(r.class || "") !== filterClass) return false;
      if (filterGender && String(r.gender || "").toUpperCase() !== String(filterGender).toUpperCase()) return false;
      const gid = memberMap.get(r.id) || "";
      if (filterGroupId && gid !== filterGroupId) return false;
      if (!q) return true;
      const groupLabel = gid ? `${groupById.get(gid)?.group_code || ""} ${groupById.get(gid)?.group_name || ""}`.toLowerCase() : "";
      const hay = `${r.student_identifier || ""} ${r.name || ""} ${r.class || ""} ${groupLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [roster, filterQuery, filterClass, filterGender, filterGroupId, memberMap, groupById]);

  const toggleSelected = (studentId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  };

  const toggleAllFiltered = (checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) filtered.forEach((r) => next.add(r.id));
      else filtered.forEach((r) => next.delete(r.id));
      return next;
    });
  };

  const nextDefaultGroupCode = () => {
    let n = 1;
    const existing = new Set((groups || []).map((g) => String(g.group_code || "").toUpperCase()));
    while (existing.has(`G${String(n).padStart(2, "0")}`)) n += 1;
    return `G${String(n).padStart(2, "0")}`;
  };

  const createGroup = async (codeInput, nameInput) => {
    const groupCode = String(codeInput || "").trim().toUpperCase();
    const groupName = String(nameInput || "").trim() || groupCode;
    if (!groupCode) throw new Error("Group code is required.");
    const { data, error } = await supabase
      .from("session_groups")
      .insert({ session_id: sessionId, group_code: groupCode, group_name: groupName })
      .select("id, session_id, group_code, group_name")
      .single();
    if (error) throw error;
    setGroups((prev) => [...prev, data].sort((a, b) => String(a.group_code).localeCompare(String(b.group_code))));
    return data;
  };

  const openGroupModal = (target = "create") => {
    const defaultCode = nextDefaultGroupCode();
    setGroupModalTarget(target);
    setGroupCodeDraft(defaultCode);
    setGroupNameDraft(defaultCode);
    setGroupModalOpen(true);
  };

  const submitGroupModal = async () => {
    const code = String(groupCodeDraft || "").trim().toUpperCase();
    const name = String(groupNameDraft || "").trim() || code;
    if (!code) return;
    try {
      setLoading(true);
      setMessage("");
      const created = await createGroup(code, name);
      showMessage("groups", `Group ${created.group_code} created.`);
      if (groupModalTarget === "bulk") setBulkGroupId(created.id);
      setGroupModalOpen(false);
    } catch (e) {
      showMessage("groups", e.message || "Failed to create group.");
    } finally {
      setLoading(false);
    }
  };

  const updateOneMembership = async (studentId, sessionGroupId) => {
    if (!canManage) return;
    try {
      setMessage("");
      if (!sessionGroupId) {
        const { error } = await supabase
          .from("session_group_members")
          .delete()
          .match({ session_id: sessionId, student_id: studentId });
        if (error) throw error;
        setMemberMap((prev) => {
          const next = new Map(prev);
          next.delete(studentId);
          return next;
        });
        return;
      }
      const { error } = await supabase
        .from("session_group_members")
        .upsert([{ session_id: sessionId, session_group_id: sessionGroupId, student_id: studentId }], { onConflict: "session_id,student_id" });
      if (error) throw error;
      setMemberMap((prev) => {
        const next = new Map(prev);
        next.set(studentId, sessionGroupId);
        return next;
      });
    } catch (e) {
      showMessage("assign", e.message || "Failed to update group.");
    }
  };

  const applyBulkGroup = async () => {
    if (!canManage) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    setLoading(true);
    setMessage("");
    try {
      if (!bulkGroupId) {
        const { error } = await supabase
          .from("session_group_members")
          .delete()
          .eq("session_id", sessionId)
          .in("student_id", ids);
        if (error) throw error;
        setMemberMap((prev) => {
          const next = new Map(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        showMessage("assign", `Cleared group for ${ids.length} student(s).`);
      } else {
        const payload = ids.map((id) => ({ session_id: sessionId, student_id: id, session_group_id: bulkGroupId }));
        const { error } = await supabase
          .from("session_group_members")
          .upsert(payload, { onConflict: "session_id,student_id" });
        if (error) throw error;
        setMemberMap((prev) => {
          const next = new Map(prev);
          ids.forEach((id) => next.set(id, bulkGroupId));
          return next;
        });
        showMessage("assign", `Assigned ${ids.length} student(s).`);
      }
    } catch (e) {
      showMessage("assign", e.message || "Bulk update failed.");
    } finally {
      setLoading(false);
    }
  };

  const deleteGroupConfirmed = async (groupId) => {
    if (!canManage) return;
    setLoading(true);
    setMessage("");
    try {
      const { error: mErr } = await supabase
        .from("session_group_members")
        .delete()
        .match({ session_id: sessionId, session_group_id: groupId });
      if (mErr) throw mErr;
      const { error: gErr } = await supabase
        .from("session_groups")
        .delete()
        .match({ id: groupId, session_id: sessionId });
      if (gErr) throw gErr;
      setGroups((prev) => prev.filter((x) => x.id !== groupId));
      setMemberMap((prev) => {
        const next = new Map(prev);
        Array.from(next.entries()).forEach(([sid, gid]) => { if (gid === groupId) next.delete(sid); });
        return next;
      });
      showMessage("groups", "Group deleted.");
    } catch (e) {
      showMessage("groups", e.message || "Failed to delete group.");
    } finally {
      setLoading(false);
    }
  };

  const unassignAllStudentsConfirmed = async () => {
    if (!canManage || !sessionId) return;
    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase
        .from("session_group_members")
        .delete()
        .eq("session_id", sessionId);
      if (error) throw error;
      setMemberMap(new Map());
      setSelected(new Set());
      showMessage("groups", "All students unassigned from groups.");
    } catch (e) {
      showMessage("groups", e.message || "Failed to unassign students.");
    } finally {
      setLoading(false);
    }
  };

  const clearAndDeleteAllGroupsConfirmed = async () => {
    if (!canManage || !sessionId) return;
    setLoading(true);
    setMessage("");
    try {
      const { error: mErr } = await supabase
        .from("session_group_members")
        .delete()
        .eq("session_id", sessionId);
      if (mErr) throw mErr;
      const { error: gErr } = await supabase
        .from("session_groups")
        .delete()
        .eq("session_id", sessionId);
      if (gErr) throw gErr;
      setMemberMap(new Map());
      setGroups([]);
      setBulkGroupId("");
      setFilterGroupId("");
      setSelected(new Set());
      showMessage("groups", "All groups and assignments cleared for this session.");
    } catch (e) {
      showMessage("groups", e.message || "Failed to clear groups.");
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteGroup = (groupId) => {
    const g = groupById.get(groupId);
    setConfirmState({
      open: true,
      title: "Delete Group",
      message: `Delete group "${g?.group_code || ""}" and unassign its students?`,
      confirmText: "Delete",
      tone: "danger",
      action: "delete_group",
      groupId,
    });
  };

  const confirmUnassignAll = () => {
    setConfirmState({
      open: true,
      title: "Unassign All Students",
      message: "Unassign all students from groups for this session? Groups will remain.",
      confirmText: "Unassign All",
      tone: "warning",
      action: "unassign_all",
      groupId: null,
    });
  };

  const confirmClearDeleteAll = () => {
    setConfirmState({
      open: true,
      title: "Clear & Delete All Groups",
      message: "This will remove all group assignments and delete all groups in this session. This cannot be undone.",
      confirmText: "Delete All",
      tone: "danger",
      action: "clear_delete_all",
      groupId: null,
    });
  };

  const runConfirmedAction = async () => {
    const action = confirmState.action;
    const groupId = confirmState.groupId;
    setConfirmState((prev) => ({ ...prev, open: false }));
    if (action === "delete_group" && groupId) {
      await deleteGroupConfirmed(groupId);
      return;
    }
    if (action === "unassign_all") {
      await unassignAllStudentsConfirmed();
      return;
    }
    if (action === "clear_delete_all") {
      await clearAndDeleteAllGroupsConfirmed();
    }
  };

  const ensureGroups = async (count) => {
    const existing = [...groups];
    if (existing.length >= count) return existing.slice(0, count);
    let acc = [...existing];
    while (acc.length < count) {
      const code = (() => {
        let n = 1;
        const used = new Set(acc.map((g) => String(g.group_code || "").toUpperCase()));
        while (used.has(`G${String(n).padStart(2, "0")}`)) n += 1;
        return `G${String(n).padStart(2, "0")}`;
      })();
      const created = await createGroup(code, code);
      acc = [...acc, created];
    }
    return acc.slice(0, count);
  };

  const runAutoAssign = async () => {
    if (!canManage) return;
    const parsed = parseInt(String(autoSizeInput || "").trim(), 10);
    const size = Math.max(1, Math.min(60, Number.isFinite(parsed) ? parsed : autoSize || 1));
    setAutoSize(size);
    setAutoSizeInput(String(size));
    const candidates = [...roster].sort((a, b) => String(a.class || "").localeCompare(String(b.class || "")) || String(a.name || "").localeCompare(String(b.name || "")));
    if (!candidates.length) return;

    const buckets = new Map();
    candidates.forEach((s) => {
      const kClass = autoByClass ? String(s.class || "Unassigned") : "";
      const kGender = autoByGender ? String(s.gender || "U") : "";
      const key = `${kClass}||${kGender}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    });
    const splitEvenlyByTargetSize = (arr, targetSize) => {
      const total = arr.length;
      if (!total) return [];
      const groupCount = Math.max(1, Math.ceil(total / targetSize));
      const base = Math.floor(total / groupCount);
      const remainder = total % groupCount;
      const out = [];
      let cursor = 0;
      for (let i = 0; i < groupCount; i += 1) {
        const take = base + (i < remainder ? 1 : 0);
        out.push(arr.slice(cursor, cursor + take));
        cursor += take;
      }
      return out;
    };

    const chunks = [];
    buckets.forEach((arr) => {
      splitEvenlyByTargetSize(arr, size).forEach((chunk) => chunks.push(chunk));
    });
    if (!chunks.length) return;

    setLoading(true);
    setMessage("");
    try {
      const targetGroups = await ensureGroups(chunks.length);
      const payload = [];
      chunks.forEach((chunk, idx) => {
        const gid = targetGroups[idx].id;
        chunk.forEach((s) => payload.push({ session_id: sessionId, student_id: s.id, session_group_id: gid }));
      });
      const { error } = await supabase
        .from("session_group_members")
        .upsert(payload, { onConflict: "session_id,student_id" });
      if (error) throw error;
      const next = new Map(memberMap);
      payload.forEach((p) => next.set(p.student_id, p.session_group_id));
      setMemberMap(next);
      showMessage("auto", `Auto-assigned ${payload.length} student(s) into ${chunks.length} group(s).`);
      setAutoAssignNotice(`Auto-assigned ${payload.length} student(s) into ${chunks.length} group(s).`);
    } catch (e) {
      showMessage("auto", e.message || "Auto-assign failed.");
      setAutoAssignNotice("");
    } finally {
      setLoading(false);
    }
  };

  const downloadGroupRoster = () => {
    const header = ["Student ID", "Name", "Class", "Gender", "Group", "Group Name"].map(csvCell).join(",");
    const rows = (roster || []).map((r) => {
      const gid = memberMap.get(r.id);
      const g = gid ? groupById.get(gid) : null;
      return [
        normalizeStudentId(r.student_identifier),
        r.name || "",
        r.class || "",
        r.gender || "",
        g?.group_code || "",
        g?.group_name || "",
      ].map(csvCell).join(",");
    });
    downloadCsv([header, ...rows].join("\n") + "\n", `group_roster_${sessionYear}.csv`);
  };

  const onGroupCsvUpload = async (file) => {
    if (!file || !sessionId) return;
    setLoading(true);
    setMessage("");
    try {
      const text = await file.text();
      const parsed = parseGroupCsv(text);
      if (parsed.error) {
        showMessage("upload", parsed.error);
        return;
      }
      const rosterById = new Map((roster || []).map((r) => [String(normalizeStudentId(r.student_identifier || "")).toUpperCase(), r]));
      const groupByCode = new Map((groups || []).map((g) => [String(g.group_code || "").toUpperCase(), g]));
      const missingGroupCodes = new Set();
      parsed.rows.forEach((row) => {
        const code = String(row.group || "").trim().toUpperCase();
        if (code && !groupByCode.has(code)) missingGroupCodes.add(code);
      });
      for (const code of Array.from(missingGroupCodes)) {
        const created = await createGroup(code, code);
        groupByCode.set(code, created);
      }

      const updates = [];
      const errors = [];
      parsed.rows.forEach((row) => {
        const sid = String(row.studentId || "").toUpperCase();
        if (!sid) return;
        const matched = rosterById.get(sid);
        if (!matched) {
          errors.push(`Row ${row.row}: student not in roster (${sid}).`);
          return;
        }
        const code = String(row.group || "").trim().toUpperCase();
        if (!code) return;
        const grp = groupByCode.get(code);
        if (!grp?.id) {
          errors.push(`Row ${row.row}: unknown group (${code}).`);
          return;
        }
        updates.push({ session_id: sessionId, student_id: matched.id, session_group_id: grp.id });
      });
      if (!updates.length) {
        showMessage("upload", errors.length ? errors.slice(0, 4).join(" ") : "No valid rows found.");
        return;
      }
      const { error } = await supabase
        .from("session_group_members")
        .upsert(updates, { onConflict: "session_id,student_id" });
      if (error) throw error;
      await loadData();
      showMessage("upload", `Updated ${updates.length} student(s).${errors.length ? ` ${errors.length} warning(s).` : ""}`);
    } catch (e) {
      showMessage("upload", e.message || "Failed to import groups.");
    } finally {
      setLoading(false);
      if (groupFileRef.current) groupFileRef.current.value = "";
    }
  };

  const exportGroupSheets = async () => {
    if (!sessionId) return;
    setLoading(true);
    setMessage("");
    try {
      const groupsSorted = [...groups].sort((a, b) => String(a.group_code || "").localeCompare(String(b.group_code || "")));
      if (!groupsSorted.length) {
        showMessage("export", "No groups to print.");
        return;
      }
      const membersByGroup = new Map();
      (roster || []).forEach((s) => {
        const gid = memberMap.get(s.id);
        if (!gid) return;
        if (!membersByGroup.has(gid)) membersByGroup.set(gid, []);
        membersByGroup.get(gid).push(s);
      });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      let first = true;
      for (const g of groupsSorted) {
        if (!first) pdf.addPage();
        first = false;
        const qrPayload = encodeGroupQr({ sessionId, groupCode: g.group_code });
        const qrDataUrl = await drawQrDataUrl(qrPayload, 300, "M", 0);
        const pageW = 297;
        const pageH = 210;
        const margin = 10;
        const qrSize = 42;
        const qrX = pageW - margin - qrSize;
        const qrY = 14;
        const captionY = qrY + qrSize + 8; // increased gap below QR

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text(String(session?.title || "Session"), margin, 16);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(12);
        pdf.text(`Group: ${g.group_code}${g.group_name ? ` - ${g.group_name}` : ""}`, margin, 24);
        pdf.text(`Date: ${session?.session_date ? new Date(session.session_date).toLocaleDateString() : "-"}`, margin, 31);
        pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
        pdf.setFontSize(14);
        pdf.text("Group QR code", qrX, captionY);

        const list = [...(membersByGroup.get(g.id) || [])].sort((a, b) => String(a.class || "").localeCompare(String(b.class || "")) || String(a.name || "").localeCompare(String(b.name || "")));
        const cols = [
          { key: "no", label: "No", w: 10 },
          { key: "id", label: "Student ID", w: 34 },
          { key: "name", label: "Name", w: 72 },
          { key: "class", label: "Class", w: 20 },
          { key: "situps", label: "Sit-ups", w: 24 },
          { key: "broad", label: "Broad Jump", w: 30 },
          { key: "reach", label: "Sit & Reach", w: 28 },
          { key: "pullups", label: "Pull-ups", w: 22 },
          { key: "shuttle", label: "Shuttle", w: 23 },
          { key: "run", label: "Run", w: 14 },
        ];
        const tableX = margin;
        const tableW = cols.reduce((acc, c) => acc + c.w, 0);
        let y = Math.max(58, captionY + 8);
        pdf.setFillColor(240, 244, 248);
        pdf.rect(tableX, y - 6, tableW, 8, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        let x = tableX;
        cols.forEach((c) => {
          pdf.text(c.label, x + 1.5, y);
          x += c.w;
        });
        y += 5;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(14);
        const lineH = 12; // doubled row height for manual writing
        const maxRows = Math.floor((pageH - margin - y) / lineH);
        for (let i = 0; i < Math.min(maxRows, list.length); i += 1) {
          const s = list[i];
          let cx = tableX;
          cols.forEach((c) => {
            pdf.rect(cx, y - 4, c.w, lineH);
            cx += c.w;
          });
          const rowCenterTextY = y + 3;
          pdf.text(String(i + 1), tableX + 1.5, rowCenterTextY);
          pdf.setFontSize(10);
          const idText = trimText(pdf, normalizeStudentId(s.student_identifier), cols[1].w - 3);
          pdf.text(idText, tableX + cols[0].w + 1.5, rowCenterTextY);
          pdf.setFontSize(14);
          const nameX = tableX + cols[0].w + cols[1].w + 1.5;
          const nameLines = wrapTwoLines(pdf, s.name || "", cols[2].w - 3);
          if (nameLines.length === 1) {
            pdf.text(nameLines[0], nameX, rowCenterTextY);
          } else {
            pdf.text(nameLines[0], nameX, y + 1);
            pdf.text(nameLines[1], nameX, y + 6);
          }
          const classX = tableX + cols[0].w + cols[1].w + cols[2].w + 1.5;
          pdf.text(String(s.class || "-"), classX, rowCenterTextY);
          y += lineH;
        }
      }
      pdf.save(`group_qr_sheet_${session?.title || "session"}.pdf`);
      showMessage("export", "Group QR sheet downloaded.");
    } catch (e) {
      showMessage("export", e.message || "Failed to generate group sheets.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard label="Total Students" value={String((roster || []).length)} />
        <SummaryCard label="Groups" value={String((groups || []).length)} />
        <SummaryCard label="Assigned" value={String(assignedCount)} />
        <SummaryCard label="Unassigned" value={String(unassignedCount)} />
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-2 space-y-2">
        <div className="space-y-0">
          <SectionToggle
            step="1"
            title="Manage Groups"
            subtitle="Create groups, import a list, or auto-assign students"
            open={openSections.setup}
            onToggle={() => toggleSection("setup")}
            className="border-sky-200 bg-sky-100/70 hover:bg-sky-100"
          />
          <CollapsiblePanel open={openSections.setup}>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
            <div className="border rounded-lg bg-white p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-700">Groups</div>
                  <div className="text-xs text-gray-500">{groups.length ? "Review group codes and membership counts." : "Create or import groups before assigning students."}</div>
                </div>
                <div className="relative">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setMaintenanceOpen((v) => !v)}
                      disabled={loading}
                      className="text-xs px-2.5 py-1 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      More actions
                    </button>
                  )}
                  {maintenanceOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded border bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => { setMaintenanceOpen(false); confirmUnassignAll(); }}
                        disabled={loading}
                        className="w-full px-3 py-2 text-left text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      >
                        Unassign all students
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMaintenanceOpen(false); confirmClearDeleteAll(); }}
                        disabled={loading}
                        className="w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Clear & delete all groups
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {groups.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2 border rounded px-2 py-1 bg-white">
                      <span className="text-sm">{g.group_code}{g.group_name ? ` - ${g.group_name}` : ""} ({groupedCounts.get(g.id) || 0})</span>
                      {canManage && <button onClick={() => confirmDeleteGroup(g.id)} className="text-xs px-2 py-0.5 border rounded hover:bg-gray-50">Delete</button>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-gray-600">No groups created yet.</div>
              )}
            </div>

            <div className="space-y-2">
              {canManage && (
                <div className="border rounded-lg bg-white p-2 space-y-2">
                  <div className="text-sm font-medium text-gray-700">Create or import</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => openGroupModal("create")} disabled={loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Create Group</button>
                    <button onClick={() => groupFileRef.current?.click()} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50">Upload Group List</button>
                    <input ref={groupFileRef} type="file" accept=".csv,text/csv" onChange={(e) => onGroupCsvUpload(e.target.files?.[0])} className="hidden" />
                  </div>
                  <div className="text-xs text-gray-500">Upload uses the same CSV format as Download Group List.</div>
                  {message && (messageArea === "upload" || messageArea === "groups") && (
                    <div className="text-sm text-gray-700">{message}</div>
                  )}
                </div>
              )}

              {canManage && (
                <div className="border border-emerald-200 rounded-lg bg-emerald-50 p-2 space-y-2">
                  <div className="text-sm text-emerald-800 font-medium">Auto assign</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm inline-flex items-center gap-1"><input type="checkbox" checked={autoByClass} onChange={(e) => setAutoByClass(e.target.checked)} />By class</label>
                    <label className="text-sm inline-flex items-center gap-1"><input type="checkbox" checked={autoByGender} onChange={(e) => setAutoByGender(e.target.checked)} />By gender</label>
                    <label className="text-sm text-emerald-800">Students/group</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={autoSizeInput}
                      onChange={(e) => setAutoSizeInput(e.target.value)}
                      onBlur={() => {
                        const parsed = parseInt(String(autoSizeInput || "").trim(), 10);
                        const next = Math.max(1, Math.min(60, Number.isFinite(parsed) ? parsed : autoSize || 1));
                        setAutoSize(next);
                        setAutoSizeInput(String(next));
                      }}
                      className="border rounded px-2 py-1 w-24"
                    />
                    <button onClick={runAutoAssign} disabled={loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Auto Assign</button>
                  </div>
                  {autoAssignNotice && <div className="text-sm text-green-700">{autoAssignNotice}</div>}
                  {message && messageArea === "auto" && !autoAssignNotice && (
                    <div className="text-sm text-gray-700">{message}</div>
                  )}
                </div>
              )}

              <div className="border rounded-lg bg-white p-2 space-y-2">
                <div>
                  <div className="text-sm font-medium text-gray-700">Print / Export</div>
                  <div className="text-xs text-gray-500">
                    {assignedCount} assigned, {unassignedCount} unassigned, {groups.length} groups.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={exportGroupSheets} disabled={loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Print Group QR Sheet</button>
                  <button onClick={downloadGroupRoster} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50">Download Group List</button>
                </div>
                {message && messageArea === "export" && (
                  <div className="text-sm text-gray-700">{message}</div>
                )}
              </div>
            </div>
          </div>
          </CollapsiblePanel>
        </div>

        <div className="space-y-0">
          <SectionToggle
            step="2"
            title="Assign Students"
            subtitle="Assign selected students in bulk or edit each row directly"
            open={openSections.assign}
            onToggle={() => toggleSection("assign")}
            className="border-sky-200 bg-sky-100/70 hover:bg-sky-100"
          />
          <CollapsiblePanel open={openSections.assign}>
          <>
          {groups.length === 0 && (
            <div className="border border-amber-200 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Create groups before assigning students.
            </div>
          )}
          {canManage && selected.size > 0 && (
            <div className="border rounded-lg bg-white p-2 flex items-center flex-wrap gap-2">
              <label className="text-sm text-gray-600">Set group for selected</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-white"
                value={bulkGroupId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__new__") {
                    openGroupModal("bulk");
                  } else {
                    setBulkGroupId(val);
                  }
                }}
              >
                <option value="">Unassigned</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.group_code}{g.group_name ? ` - ${g.group_name}` : ""}</option>
                ))}
                <option value="__new__">Add new...</option>
              </select>
              <button onClick={applyBulkGroup} disabled={selected.size === 0 || loading} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50">Apply</button>
              {message && messageArea === "assign" && (
                <span className="text-sm text-gray-700">{message}</span>
              )}
            </div>
          )}

          <div className="table-scroll">
            <div className="p-2 border-b bg-white grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <label className="text-gray-600">Search</label>
                <input type="text" value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} placeholder="Name or ID" className="border rounded px-2 py-1 bg-white w-full" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-gray-600">Class</label>
                <select className="border rounded px-2 py-1 bg-white w-full" value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
                  <option value="">All</option>
                  {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
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
                <label className="text-gray-600">Group</label>
                <select className="border rounded px-2 py-1 bg-white w-full" value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)}>
                  <option value="">All</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.group_code}</option>)}
                </select>
              </div>
            </div>
            <table className="data-table compact-data-table min-w-[720px]">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border w-8">
                    <input type="checkbox" checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))} onChange={(e) => toggleAllFiltered(e.target.checked)} />
                  </th>
                  <th className="px-3 py-2 border">ID</th>
                  <th className="px-3 py-2 border">Name</th>
                  <th className="px-3 py-2 border">Class</th>
                  <th className="px-3 py-2 border">Gender</th>
                  <th className="px-3 py-2 border">Group</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan="6" className="px-3 py-4 text-center text-gray-500">No students in roster.</td></tr>
                ) : filtered.map((s) => {
                  const gid = memberMap.get(s.id) || "";
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} /></td>
                      <td className="px-3 py-2 border whitespace-nowrap">{normalizeStudentId(s.student_identifier)}</td>
                      <td className="px-3 py-2 border">{s.name}</td>
                      <td className="px-3 py-2 border">{s.class || ""}</td>
                      <td className="px-3 py-2 border">{s.gender || ""}</td>
                      <td className="px-3 py-2 border">
                        {canManage ? (
                          <select className="border rounded px-2 py-1 text-sm bg-white" value={gid} onChange={(e) => updateOneMembership(s.id, e.target.value)}>
                            <option value="">Unassigned</option>
                            {groups.map((g) => (
                              <option key={g.id} value={g.id}>{g.group_code}{g.group_name ? ` - ${g.group_name}` : ""}</option>
                            ))}
                          </select>
                        ) : (
                          <span>{gid ? (groupById.get(gid)?.group_code || "-") : "-"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
          </CollapsiblePanel>
        </div>
      </div>

      {message && messageArea === "global" && <div className="text-sm text-gray-700">{message}</div>}
      <GroupPromptModal
        open={groupModalOpen}
        code={groupCodeDraft}
        name={groupNameDraft}
        onCodeChange={(v) => setGroupCodeDraft(v)}
        onNameChange={(v) => setGroupNameDraft(v)}
        onCancel={() => setGroupModalOpen(false)}
        onConfirm={submitGroupModal}
      />
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        tone={confirmState.tone}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
        onConfirm={runConfirmedAction}
      />
    </section>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="border rounded-lg bg-white px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function SectionToggle({ step, title, subtitle, open, onToggle, className = "" }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full border rounded-lg bg-white px-3 py-2 text-left hover:bg-gray-50 ${className}`}
      aria-expanded={open}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {step ? (
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
              {step}
            </span>
          ) : null}
          <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800">{title}</div>
          {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : null}
          </div>
        </div>
        <span className="text-xs text-gray-500">{open ? "Hide" : "Show"}</span>
      </div>
    </button>
  );
}

function CollapsiblePanel({ open, children }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="space-y-0">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function GroupPromptModal({ open, code, name, onCodeChange, onNameChange, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/35" onClick={onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-lg shadow-lg border">
          <div className="px-4 py-3 border-b">
            <div className="font-medium">Add New Group</div>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-sm text-gray-700">Group code</label>
              <input
                autoFocus
                value={code}
                onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
                className="mt-1 w-full border rounded px-3 py-2"
                placeholder="e.g. G01"
              />
            </div>
            <div>
              <label className="text-sm text-gray-700">Group name (optional)</label>
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }}
                className="mt-1 w-full border rounded px-3 py-2"
                placeholder="e.g. Group 1"
              />
            </div>
          </div>
          <div className="px-4 py-3 border-t flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={onConfirm} className="px-3 py-1.5 border rounded bg-blue-600 text-white hover:bg-blue-700">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, title, message, confirmText, tone, onCancel, onConfirm }) {
  if (!open) return null;
  const confirmClass = tone === "warning"
    ? "px-3 py-1.5 border rounded bg-amber-600 text-white hover:bg-amber-700"
    : "px-3 py-1.5 border rounded bg-red-600 text-white hover:bg-red-700";
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/35" onClick={onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-lg shadow-lg border">
          <div className="px-4 py-3 border-b">
            <div className="font-medium">{title}</div>
          </div>
          <div className="p-4 text-sm text-gray-700">{message}</div>
          <div className="px-4 py-3 border-t flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={onConfirm} className={confirmClass}>{confirmText || "Confirm"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function trimText(pdf, text, maxW) {
  const s = String(text || "");
  if (!s) return "";
  let out = s;
  while (out && pdf.getTextWidth(out) > maxW) out = out.slice(0, -1);
  return out === s ? s : `${out}...`;
}

function wrapTwoLines(pdf, text, maxW) {
  const raw = String(text || "").trim();
  if (!raw) return [""];
  const words = raw.split(/\s+/);
  const lines = [];
  let cur = "";
  let truncated = false;

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const candidate = cur ? `${cur} ${w}` : w;
    if (pdf.getTextWidth(candidate) <= maxW) {
      cur = candidate;
      continue;
    }
    if (!cur) {
      // single long token
      lines.push(trimText(pdf, w, maxW));
      cur = "";
    } else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length === 2) {
      truncated = i < words.length - 1 || !!cur;
      break;
    }
  }
  if (lines.length < 2 && cur) lines.push(cur);
  if (lines.length > 2) truncated = true;
  if (lines.length === 1) return [trimText(pdf, lines[0], maxW)];
  let second = lines[1] || "";
  if (truncated) {
    second = trimText(pdf, second, maxW);
    if (!second.endsWith("...")) second = trimText(pdf, `${second} ...`, maxW);
  } else {
    second = trimText(pdf, second, maxW);
  }
  return [trimText(pdf, lines[0], maxW), second];
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
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseGroupCsv(csvText) {
  const lines = String(csvText).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]).map((c) => c.toLowerCase());
    if (cols.some((c) => c.includes("group")) && cols.some((c) => c.includes("id"))) {
      headerIdx = i;
      break;
    }
  }
  const headers = splitCsvLine(lines[headerIdx]).map((c) => c.trim().toLowerCase());
  const idxId = headers.findIndex((h) => h.includes("student id") || h === "id" || h.includes("studentid"));
  const idxName = headers.findIndex((h) => h.includes("name"));
  const idxClass = headers.findIndex((h) => h.includes("class"));
  const idxGender = headers.findIndex((h) => h.includes("gender"));
  const idxGroup = headers.findIndex((h) => h.includes("group"));
  if (idxId < 0 || idxGroup < 0) {
    return { rows: [], headerIndex: headerIdx, error: "Missing required columns: Student ID and Group." };
  }
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = splitCsvLine(raw);
    rows.push({
      row: i + 1,
      studentId: idxId >= 0 ? normalizeStudentId(cols[idxId] || "") : "",
      name: idxName >= 0 ? (cols[idxName] || "").trim() : "",
      klass: idxClass >= 0 ? (cols[idxClass] || "").trim() : "",
      gender: idxGender >= 0 ? (cols[idxGender] || "").trim() : "",
      group: idxGroup >= 0 ? (cols[idxGroup] || "").trim() : "",
    });
  }
  return { rows, headerIndex: headerIdx };
}
