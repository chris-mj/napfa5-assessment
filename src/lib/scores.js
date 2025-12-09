// Shared helpers for score fields and formatting

export const SCORE_SELECT_FIELDS = 'situps, pullups, broad_jump, sit_and_reach, shuttle_run, run_2400';

// Fetch a single score row for a session + student
export async function fetchScoreRow(supabase, sessionId, studentId) {
  const { data, error } = await supabase
    .from('scores')
    .select(SCORE_SELECT_FIELDS)
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Format minutes (float) to mm:ss; accepts number or numeric string
export function fmtRun(val) {
  if (val == null) return null;
  const min = Number(val);
  if (!Number.isFinite(min)) return null;
  const total = Math.round(min * 60);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

