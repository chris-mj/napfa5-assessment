export function encodeGroupQr({ sessionId, groupCode }) {
  return JSON.stringify({
    v: 1,
    t: "group",
    sid: String(sessionId || ""),
    gc: String(groupCode || ""),
  });
}

export function parseGroupQr(raw) {
  try {
    const obj = JSON.parse(String(raw || ""));
    if (!obj || obj.t !== "group" || Number(obj.v) !== 1) return null;
    const sid = String(obj.sid || "").trim();
    const gc = String(obj.gc || "").trim();
    if (!sid || !gc) return null;
    return { sessionId: sid, groupCode: gc };
  } catch {
    return null;
  }
}
