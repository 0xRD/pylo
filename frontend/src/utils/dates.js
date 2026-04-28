/**
 * Parse a datetime string from the backend (always UTC, may lack Z suffix).
 * Returns a Date object in the browser's local timezone.
 */
export function parseUTC(dateStr) {
  if (!dateStr) return null
  const s = String(dateStr)
  // If it already has timezone info, use as-is; otherwise append Z to mark as UTC
  if (s.endsWith('Z') || s.includes('+') || s.includes('-', 10)) return new Date(s)
  return new Date(s + 'Z')
}

export function fmtDateTime(dateStr) {
  const d = parseUTC(dateStr)
  return d ? d.toLocaleString() : ''
}

export function fmtDate(dateStr) {
  const d = parseUTC(dateStr)
  return d ? d.toLocaleDateString() : ''
}

export function fmtTime(dateStr) {
  const d = parseUTC(dateStr)
  return d ? d.toLocaleTimeString() : ''
}

export function fmtShort(dateStr, opts = {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) {
  const d = parseUTC(dateStr)
  return d ? d.toLocaleString('en-GB', opts) : ''
}
