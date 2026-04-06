import { startLoaderMetric } from "./devLoaderMetrics";

const DEFAULT_ENROLLMENT_FIELDS = "student_id,class,academic_year,is_active,school_id";
const DEFAULT_STUDENT_FIELDS = ["id", "student_identifier", "name"];

function chunkArray(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeAcademicYear(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compareNullableStrings(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function compareEnrollmentPriority(a, b, schoolId, sessionYear) {
  const targetYear = normalizeAcademicYear(sessionYear);
  const yearA = normalizeAcademicYear(a?.academic_year);
  const yearB = normalizeAcademicYear(b?.academic_year);
  const sameSchoolA = schoolId ? a?.school_id === schoolId : false;
  const sameSchoolB = schoolId ? b?.school_id === schoolId : false;
  const sameYearA = targetYear != null && yearA === targetYear;
  const sameYearB = targetYear != null && yearB === targetYear;
  const activeA = !!a?.is_active;
  const activeB = !!b?.is_active;

  if (sameSchoolA !== sameSchoolB) return sameSchoolA ? -1 : 1;
  if (sameYearA !== sameYearB) return sameYearA ? -1 : 1;
  if (activeA !== activeB) return activeA ? -1 : 1;
  if ((yearA || 0) !== (yearB || 0)) return (yearB || 0) - (yearA || 0);
  const schoolCmp = compareNullableStrings(a?.school_id, b?.school_id);
  if (schoolCmp !== 0) return schoolCmp;
  return compareNullableStrings(a?.class, b?.class);
}

/**
 * Resolve the most appropriate class label for a student's enrollments.
 * The result is deterministic for identical inputs.
 *
 * Priority:
 * 1. same school + session year + active
 * 2. same school + session year
 * 3. same school + active + latest academic year
 * 4. same school + latest academic year
 * 5. active + latest academic year
 * 6. latest academic year overall
 *
 * @param {Array<{class?: string, academic_year?: number, is_active?: boolean, school_id?: string}>} enrollments
 * @param {{ schoolId?: string | null, sessionYear?: number | string | null }} [options]
 * @returns {string}
 */
export function resolveEnrollmentClass(enrollments, { schoolId = null, sessionYear = null } = {}) {
  const list = Array.isArray(enrollments) ? enrollments.filter(Boolean) : [];
  if (!list.length) return "";
  const sorted = [...list].sort((a, b) => compareEnrollmentPriority(a, b, schoolId, sessionYear));
  return sorted[0]?.class || "";
}

/**
 * Fetch enrollments grouped by `student_id`.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} studentIds
 * @param {{ fields?: string }} [options]
 * @returns {Promise<Map<string, Array<{student_id: string, class?: string, academic_year?: number, is_active?: boolean, school_id?: string}>>>}
 */
export async function fetchEnrollmentsMap(supabase, studentIds, options = {}) {
  const ids = uniqueValues(studentIds);
  const fields = options.fields || DEFAULT_ENROLLMENT_FIELDS;
  const metricDone = startLoaderMetric("fetchEnrollmentsMap", {
    students_requested: ids.length,
  });
  const out = new Map();
  if (!ids.length) {
    metricDone({ rows: 0 });
    return out;
  }

  let totalRows = 0;
  try {
    for (const chunk of chunkArray(ids, 500)) {
      const { data, error } = await supabase
        .from("enrollments")
        .select(fields)
        .in("student_id", chunk);
      if (error) throw error;
      (data || []).forEach((row) => {
        totalRows += 1;
        if (!out.has(row.student_id)) out.set(row.student_id, []);
        out.get(row.student_id).push(row);
      });
    }
    metricDone({ rows: totalRows });
    return out;
  } catch (error) {
    metricDone({ rows: totalRows, failed: true, error });
    throw error;
  }
}

/**
 * @typedef {Object} SessionRosterStudent
 * @property {string} id
 * @property {string} [student_identifier]
 * @property {string} [name]
 *
 * @typedef {Object} SessionRosterRow
 * @property {string} student_id
 * @property {string} [house]
 * @property {string} [class]
 * @property {SessionRosterStudent} students
 */

/**
 * Fetch lean `session_roster -> students` rows and optionally resolve one class per student.
 *
 * Query contract:
 * - reads from `session_roster`
 * - inner-joins `students`
 * - optionally reads `enrollments` in one batched second query
 * - never fetches nested enrollment JSON in the roster query
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} sessionId
 * @param {{
 *   includeHouse?: boolean,
 *   includeClass?: boolean,
 *   schoolId?: string | null,
 *   sessionYear?: number | string | null,
 *   studentFields?: string[],
 * }} [options]
 * @returns {Promise<SessionRosterRow[]>}
 */
export async function fetchSessionRosterWithStudents(supabase, sessionId, options = {}) {
  const includeHouse = options.includeHouse === true;
  const includeClass = options.includeClass !== false;
  const schoolId = options.schoolId || null;
  const sessionYear = normalizeAcademicYear(options.sessionYear);
  const studentFields = uniqueValues(options.studentFields?.length ? options.studentFields : DEFAULT_STUDENT_FIELDS);
  const metricDone = startLoaderMetric("fetchSessionRosterWithStudents", {
    session_id: sessionId,
    include_house: includeHouse,
    include_class: includeClass,
  });

  try {
    const selectParts = ["student_id"];
    if (includeHouse) selectParts.push("house");
    selectParts.push(`students!inner(${studentFields.join(",")})`);

    const { data, error } = await supabase
      .from("session_roster")
      .select(selectParts.join(","))
      .eq("session_id", sessionId)
      .order("student_id", { ascending: true });
    if (error) throw error;

    const rows = data || [];
    if (!includeClass) {
      metricDone({ rows: rows.length });
      return rows;
    }

    const studentIds = rows.map((row) => row.students?.id).filter(Boolean);
    const enrollmentsByStudent = await fetchEnrollmentsMap(supabase, studentIds);
    const resolved = rows.map((row) => ({
      ...row,
      class: resolveEnrollmentClass(enrollmentsByStudent.get(row.students?.id), { schoolId, sessionYear }),
    }));
    metricDone({ rows: resolved.length });
    return resolved;
  } catch (error) {
    metricDone({ failed: true, error });
    throw error;
  }
}

/**
 * Fetch lean `session_group_members -> students` rows and optionally resolve one class per student.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} sessionId
 * @param {string} sessionGroupId
 * @param {{
 *   schoolId?: string | null,
 *   sessionYear?: number | string | null,
 *   studentFields?: string[],
 * }} [options]
 * @returns {Promise<Array<{student_id: string, class: string, students: SessionRosterStudent}>>}
 */
export async function fetchSessionGroupMembersWithStudents(supabase, sessionId, sessionGroupId, options = {}) {
  const schoolId = options.schoolId || null;
  const sessionYear = normalizeAcademicYear(options.sessionYear);
  const studentFields = uniqueValues(options.studentFields?.length ? options.studentFields : DEFAULT_STUDENT_FIELDS);
  const metricDone = startLoaderMetric("fetchSessionGroupMembersWithStudents", {
    session_id: sessionId,
    session_group_id: sessionGroupId,
  });

  try {
    const { data, error } = await supabase
      .from("session_group_members")
      .select(`student_id, students!inner(${studentFields.join(",")})`)
      .eq("session_id", sessionId)
      .eq("session_group_id", sessionGroupId);
    if (error) throw error;

    const rows = data || [];
    const studentIds = rows.map((row) => row.students?.id).filter(Boolean);
    const enrollmentsByStudent = await fetchEnrollmentsMap(supabase, studentIds);
    const resolved = rows.map((row) => ({
      ...row,
      class: resolveEnrollmentClass(enrollmentsByStudent.get(row.students?.id), { schoolId, sessionYear }),
    }));
    metricDone({ rows: resolved.length });
    return resolved;
  } catch (error) {
    metricDone({ failed: true, error });
    throw error;
  }
}

