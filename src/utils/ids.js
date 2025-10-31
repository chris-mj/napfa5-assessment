export function normalizeStudentId(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s) return ''
  const upper = s.toUpperCase()
  if (/^[0-9]+$/.test(upper)) {
    return upper.padStart(14, '0')
  }
  return upper
}

export default normalizeStudentId

