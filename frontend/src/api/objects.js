const BASE = "/api/objects"
const TOKEN = import.meta.env.VITE_API_TOKEN || "change_me_in_production"

function headers(withBody = false) {
  const h = { "X-API-Token": TOKEN }
  if (withBody) h["Content-Type"] = "application/json"
  return h
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
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

export const objectsApi = {
  listTypes: () => req("GET", "/types"),
  createType: (data) => req("POST", "/types", data),
  getType: (id) => req("GET", `/types/${id}`),
  updateType: (id, data) => req("PUT", `/types/${id}`, data),
  deleteType: (id) => req("DELETE", `/types/${id}`),
  fetchType: (id) => req("POST", `/types/${id}/fetch`),

  listInstances: ({ typeId, q, limit = 50, offset = 0 } = {}) => {
    const params = new URLSearchParams()
    if (typeId) params.set("type_id", typeId)
    if (q) params.set("q", q)
    params.set("limit", limit)
    params.set("offset", offset)
    return req("GET", `/instances?${params}`)
  },
  getInstance: (id) => req("GET", `/instances/${id}`),
  deleteInstance: (id) => req("DELETE", `/instances/${id}`),
}
