async function apiFetch(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const dashboardApi = {
  summary: (days = 14) => apiFetch(`/api/dashboard/summary?days=${days}`),
}
