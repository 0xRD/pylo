async function req(method, path, body) {
  const res = await fetch("/api/auth" + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  if (res.status === 204) return null
  return res.json()
}

export const authApi = {
  setupStatus: () => req("GET", "/setup"),
  setup: (username, password) => req("POST", "/setup", { username, password }),
  login: (username, password) => req("POST", "/login", { username, password }),
  logout: () => req("POST", "/logout"),
  me: () => req("GET", "/me"),
}

export const usersApi = {
  list: () => fetch("/api/users", { credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject(r)),
  create: (data) => fetch("/api/users", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() }),
  update: (id, data) => fetch(`/api/users/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() }),
  delete: (id) => fetch(`/api/users/${id}`, { method: "DELETE", credentials: "include" })
    .then(r => { if (!r.ok) throw new Error(r.statusText) }),
}
