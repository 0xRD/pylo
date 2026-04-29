// Triggers a browser file download from a JSON response.
function _downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Triggers a browser file download from a ZIP response.
async function _downloadZip(res, fallbackName) {
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.detail ?? 'Backup export failed')
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const filename = match?.[1] || fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const exportApi = {
  async pybook(id) {
    const res = await fetch(`/api/pybooks/${id}/export`, { credentials: 'include' })
    if (!res.ok) throw new Error('Export failed')
    const data = await res.json()
    _downloadJson(data, `pybook_${data.name?.replace(/\s+/g, '_') ?? id}.json`)
  },

  async blueprint(id, includeEntries = false) {
    const url = `/api/blueprints/${id}/export` + (includeEntries ? '?include_entries=true' : '')
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) throw new Error('Export failed')
    const data = await res.json()
    _downloadJson(data, `blueprint_${data.name?.replace(/\s+/g, '_') ?? id}.json`)
  },

  async workflow(id) {
    const res = await fetch(`/api/workflows/${id}/export`, { credentials: 'include' })
    if (!res.ok) throw new Error('Export failed')
    const data = await res.json()
    _downloadJson(data, `workflow_${data.name?.replace(/\s+/g, '_') ?? id}.json`)
  },
}

// Reads a .json file selected by the user via a file input.
export function readImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        resolve(JSON.parse(e.target.result))
      } catch {
        reject(new Error('Invalid JSON file'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsText(file)
  })
}

// Returns { ok: true, result } on success or { ok: false, conflicts } on 409.
async function _postImport(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 409) {
    const json = await res.json()
    return { ok: false, conflicts: json.conflicts }
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.detail ?? `Import failed (${res.status})`)
  }
  return { ok: true, result: await res.json() }
}

export const importApi = {
  pybook(data, resolution, pybookResolutions) {
    return _postImport('/api/pybooks/import', { data, resolution, pybook_resolutions: pybookResolutions ?? {} })
  },
  blueprint(data, resolution, pybookResolutions) {
    return _postImport('/api/blueprints/import', { data, resolution, pybook_resolutions: pybookResolutions ?? {} })
  },
  workflow(data, resolution, pybookResolutions) {
    return _postImport('/api/workflows/import', { data, resolution, pybook_resolutions: pybookResolutions ?? {} })
  },
}

export const backupApi = {
  /** Download a full backup ZIP (secrets excluded). */
  async downloadFull() {
    const res = await fetch('/api/export/full', { credentials: 'include' })
    await _downloadZip(res, `pylo_backup_${new Date().toISOString().slice(0, 10)}.zip`)
  },

  /** Download a full backup ZIP with encrypted secrets. */
  async downloadFullWithSecrets(passphrase) {
    const res = await fetch('/api/export/full/secrets', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    })
    await _downloadZip(res, `pylo_backup_with_secrets_${new Date().toISOString().slice(0, 10)}.zip`)
  },

  /** Import a backup ZIP. Optionally supply passphrase if the backup contains encrypted secrets. */
  async importFull(file, confirm, passphrase = '') {
    const body = await file.arrayBuffer()
    const headers = { 'Content-Type': 'application/zip' }
    if (passphrase) headers['X-Backup-Passphrase'] = passphrase
    const res = await fetch(`/api/import/full?confirm=${encodeURIComponent(confirm)}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.detail ?? `Backup import failed (${res.status})`)
    return json
  },

  /** List auto-saved backup files on disk. */
  async getHistory() {
    const res = await fetch('/api/backup/history', { credentials: 'include' })
    if (!res.ok) throw new Error('Could not load backup history')
    return res.json()
  },

  /** Download a specific saved backup file. */
  async downloadSaved(filename) {
    const res = await fetch(`/api/backup/history/${encodeURIComponent(filename)}`, { credentials: 'include' })
    await _downloadZip(res, filename)
  },

  /** Delete a specific saved backup file. */
  async deleteSaved(filename) {
    const res = await fetch(`/api/backup/history/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.detail ?? 'Delete failed')
    }
  },

  /** Trigger an immediate backup to disk (no secrets). */
  async runNow() {
    const res = await fetch('/api/backup/now', { method: 'POST', credentials: 'include' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.detail ?? 'Backup failed')
    return json
  },
}
