// Turn a failed fetch Response into a readable message.
// FastAPI replies with {"detail": "..."} or, for validation errors,
// {"detail": [{"msg": "...", "loc": [...]}]}; showing that raw JSON to users is noise.
export async function errorMessage(res, fallback) {
  const text = await res.text().catch(() => "")
  try {
    const detail = JSON.parse(text).detail
    if (typeof detail === "string" && detail) return detail
    if (Array.isArray(detail) && detail.length) {
      return detail
        .map(d => [Array.isArray(d.loc) ? d.loc.filter(p => p !== "body").join(".") : "", d.msg].filter(Boolean).join(": "))
        .join("; ")
    }
    if (detail && typeof detail.message === "string") return detail.message
  } catch { /* not JSON */ }
  return text || fallback || res.statusText || `HTTP ${res.status}`
}
