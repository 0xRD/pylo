const BASE = "/api/secrets"
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
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  if (res.status === 204) return null
  return res.json()
}

export const secretsApi = {
  list: () => req("GET", ""),
  create: (data) => req("POST", "", data),
  update: (id, data) => req("PUT", `/${id}`, data),
  delete: (id) => req("DELETE", `/${id}`),
}
