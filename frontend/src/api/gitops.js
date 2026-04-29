async function _json(res) {
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(text).detail || msg; } catch (_) {}
    throw new Error(msg);
  }
  try { return JSON.parse(text); } catch (_) { return {}; }
}

export async function getGitConfig() {
  return _json(await fetch("/api/gitops/config", { credentials: "include" }));
}

export async function updateGitConfig(body) {
  return _json(await fetch("/api/gitops/config", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function getGitStatus() {
  return _json(await fetch("/api/gitops/status", { credentials: "include" }));
}

export async function getGitDiff() {
  return _json(await fetch("/api/gitops/diff", { credentials: "include" }));
}

export async function commitToGit(body) {
  return _json(await fetch("/api/gitops/commit", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function syncFromGit(body) {
  return _json(await fetch("/api/gitops/sync", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
