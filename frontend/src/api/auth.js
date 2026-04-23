async function apiFetch(method, path, body) {
  const res = await fetch(path, {
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

const req = (method, path, body) => apiFetch(method, "/api/auth" + path, body)

export const authApi = {
  setupStatus: () => req("GET", "/setup"),
  setup: (username, password) => req("POST", "/setup", { username, password }),
  login: (username, password) => req("POST", "/login", { username, password }),
  logout: () => req("POST", "/logout"),
  me: () => req("GET", "/me"),
}

export const usersApi = {
  list: () => apiFetch("GET", "/api/users"),
  create: (data) => apiFetch("POST", "/api/users", data),
  update: (id, data) => apiFetch("PATCH", `/api/users/${id}`, data),
  delete: (id) => apiFetch("DELETE", `/api/users/${id}`),
}

export const invitationsApi = {
  list: () => apiFetch("GET", "/api/invitations"),
  create: (role) => apiFetch("POST", "/api/invitations", { role }),
  revoke: (id) => apiFetch("DELETE", `/api/invitations/${id}`),
}
