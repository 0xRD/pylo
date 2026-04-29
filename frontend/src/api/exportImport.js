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
