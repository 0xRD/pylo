const BASE = "/api"

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
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  if (res.status === 204) return null
  return res.json()
}

export const pybooksApi = {
  list: () => req("GET", "/pybooks"),
  create: (data) => req("POST", "/pybooks", data),
  get: (id) => req("GET", `/pybooks/${id}`),
  update: (id, data) => req("PUT", `/pybooks/${id}`, data),
  delete: (id) => req("DELETE", `/pybooks/${id}`),
  run: (id, payload = {}, triggerSource = "manual") =>
    req("POST", `/pybooks/${id}/run`, { trigger_source: triggerSource, trigger_payload: payload }),
  build: (id) => req("POST", `/pybooks/${id}/build`),
  getRuns: (id) => req("GET", `/pybooks/${id}/runs`),
}

export const runsApi = {
  list: ({ pybookId, status, limit = 50, offset = 0 } = {}) => {
    const p = new URLSearchParams()
    if (pybookId) p.set("pybook_id", pybookId)
    if (status && status.length) status.forEach(s => p.append("status", s))
    p.set("limit", limit)
    p.set("offset", offset)
    return req("GET", `/runs?${p}`)
  },
  get: (id) => req("GET", `/runs/${id}`),
  queueStats: () => req("GET", "/runs/queue"),
}
