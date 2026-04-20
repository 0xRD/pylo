import { useEffect, useState } from 'react'
import { secretsApi } from '../api/secrets'

export default function Secrets() {
  const [secrets, setSecrets] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', value: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const load = () => secretsApi.list().then(setSecrets).catch(console.error)
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await secretsApi.create(form)
      setForm({ name: '', value: '', description: '' })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete secret "${name}"?`)) return
    await secretsApi.delete(id)
    load()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Secrets</h1>
          <p className="text-sm text-gray-500 mt-1">
            Encrypted at rest. Values are write-only — they cannot be read back through the API.
          </p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          className="text-sm px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded transition-colors">
          {showForm ? 'Cancel' : '+ New Secret'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-950 px-3 py-2 rounded">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name * <span className="text-gray-600">(used as reference)</span></label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required placeholder="virustotal_api_key"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="VirusTotal API key"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Value * <span className="text-gray-600">(stored encrypted, never shown again)</span></label>
            <input type="password" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
              required placeholder="••••••••••••••••"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
            {saving ? 'Saving…' : 'Save Secret'}
          </button>
        </form>
      )}

      {secrets.length === 0 && !showForm && (
        <p className="text-sm text-gray-600 italic">No secrets stored yet.</p>
      )}

      <div className="space-y-2">
        {secrets.map(s => (
          <div key={s.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-mono text-indigo-300">{s.name}</p>
              {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
              <p className="text-xs text-gray-600 mt-1">Added {new Date(s.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-600 font-mono">••••••••</span>
              <button onClick={() => handleDelete(s.id, s.name)}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors">Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-400">How to use secrets</p>
        <p>In object source headers: <code className="text-indigo-300 font-mono">{`{"Authorization": "Bearer {{secret:my_key}}"}`}</code></p>
        <p>In PyBooks (injected as env var): <code className="text-indigo-300 font-mono">os.environ["SECRET_my_key"]</code></p>
      </div>
    </div>
  )
}
