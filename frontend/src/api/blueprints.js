const BASE = "/api/blueprints"

function headers(withBody = false) {
  const h = {}
  if (withBody) h["Content-Type"] = "application/json"
  return h
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: headers(!!body),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  if (res.status === 204) return null
  return res.json()
}

export const blueprintsApi = {
  listBlueprints: () => req("GET", ""),
  createBlueprint: (data) => req("POST", "", data),
  getBlueprint: (id) => req("GET", `/${id}`),
  updateBlueprint: (id, data) => req("PUT", `/${id}`, data),
  deleteBlueprint: (id) => req("DELETE", `/${id}`),
  fetchBlueprint: (id) => req("POST", `/${id}/fetch`),

  listEntries: ({ blueprintId, q, limit = 50, offset = 0 } = {}) => {
    const params = new URLSearchParams()
    if (blueprintId) params.set("blueprint_id", blueprintId)
    if (q) params.set("q", q)
    params.set("limit", limit)
    params.set("offset", offset)
    return req("GET", `/entries?${params}`)
  },
  getEntry: (id) => req("GET", `/entries/${id}`),
  deleteEntry: (id) => req("DELETE", `/entries/${id}`),
  createEntry: (blueprintId, fields) => req("POST", `/${blueprintId}/entries`, { fields }),
  previewEndpoint: (data) => req("POST", "/preview", data),
  updateEntry: (blueprintId, entryId, fields) => req("PATCH", `/${blueprintId}/entries/${entryId}`, { fields }),
  getEntryHistory: (blueprintId, entryId) => req("GET", `/${blueprintId}/entries/${entryId}/history`),
  getReparseStatus: (id) => req("GET", `/${id}/reparse/status`),
}
