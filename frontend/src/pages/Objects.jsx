import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { objectsApi } from '../api/objects'
import ObjectCard from '../components/ObjectCard'

// ── helpers ───────────────────────────────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const cls = {
    gray: 'bg-gray-800 text-gray-300',
    indigo: 'bg-indigo-900 text-indigo-300',
    green: 'bg-green-900 text-green-300',
    red: 'bg-red-900 text-red-300',
  }[color] || 'bg-gray-800 text-gray-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{children}</span>
}

const EMPTY_MAPPING = { source_path: '', field_name: '', field_type: 'string' }
const FIELD_TYPES = ['string', 'number', 'boolean', 'datetime']

// ── ObjectType form (create / edit) ──────────────────────────────────────────

function TypeForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', description: '', source_url: '', source_method: 'GET',
    source_headers: '{}', source_body: '{}', field_mappings: '[]',
    trigger_pybook_id: '', polling_interval_seconds: '',
  })
  const [mappings, setMappings] = useState(() => {
    try { return JSON.parse(initial?.field_mappings || '[]') } catch { return [] }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setMapping = (i, k, v) => setMappings(ms => ms.map((m, idx) => idx === i ? { ...m, [k]: v } : m))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await onSave({
        ...form,
        field_mappings: JSON.stringify(mappings),
        polling_interval_seconds: form.polling_interval_seconds ? Number(form.polling_interval_seconds) : null,
        trigger_pybook_id: form.trigger_pybook_id || null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-950 px-3 py-2 rounded">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} required
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Description</label>
          <input value={form.description || ''} onChange={e => set('description', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-3">
          <label className="block text-xs text-gray-400 mb-1">Source URL</label>
          <input value={form.source_url || ''} onChange={e => set('source_url', e.target.value)} placeholder="https://api.example.com/data"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Method</label>
          <select value={form.source_method} onChange={e => set('source_method', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
            <option>GET</option><option>POST</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Headers (JSON)</label>
          <textarea value={form.source_headers} onChange={e => set('source_headers', e.target.value)} rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Body (JSON, POST only)</label>
          <textarea value={form.source_body} onChange={e => set('source_body', e.target.value)} rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      {/* Field mappings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-400">Field Mappings</label>
          <button type="button" onClick={() => setMappings(ms => [...ms, { ...EMPTY_MAPPING }])}
            className="text-xs text-indigo-400 hover:text-indigo-300">+ Add mapping</button>
        </div>
        {mappings.length === 0 && (
          <p className="text-xs text-gray-600 italic">No mappings — raw JSON will be stored only.</p>
        )}
        <div className="space-y-2">
          {mappings.map((m, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input value={m.source_path} onChange={e => setMapping(i, 'source_path', e.target.value)}
                placeholder="$.data.id" className="col-span-4 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              <input value={m.field_name} onChange={e => setMapping(i, 'field_name', e.target.value)}
                placeholder="external_id" className="col-span-4 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500" />
              <select value={m.field_type} onChange={e => setMapping(i, 'field_type', e.target.value)}
                className="col-span-3 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
                {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <button type="button" onClick={() => setMappings(ms => ms.filter((_, idx) => idx !== i))}
                className="col-span-1 text-gray-600 hover:text-red-400 text-center">×</button>
            </div>
          ))}
        </div>
        {mappings.length > 0 && (
          <p className="text-xs text-gray-600 mt-1">source_path · field_name · type</p>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Main Objects page ─────────────────────────────────────────────────────────

export default function Objects() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTypeId = searchParams.get('type')

  const [types, setTypes] = useState([])
  const [instances, setInstances] = useState([])
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editType, setEditType] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadTypes = () => objectsApi.listTypes().then(setTypes).catch(console.error)

  const loadInstances = (q = query) => {
    return objectsApi.listInstances({ typeId: selectedTypeId, q: q || undefined })
      .then(setInstances)
      .catch(console.error)
  }

  useEffect(() => { loadTypes().then(() => setLoading(false)) }, [])
  useEffect(() => { loadInstances() }, [selectedTypeId])

  const handleSearch = (e) => {
    e.preventDefault()
    loadInstances(query)
  }

  const handleCreate = async (data) => {
    await objectsApi.createType(data)
    setShowForm(false)
    loadTypes()
  }

  const handleUpdate = async (data) => {
    await objectsApi.updateType(editType.id, data)
    setEditType(null)
    loadTypes()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this object type and all its instances?')) return
    await objectsApi.deleteType(id)
    if (selectedTypeId === id) setSearchParams({})
    loadTypes()
    loadInstances()
  }

  const handleFetch = async (id) => {
    setFetching(true); setFetchResult(null)
    try {
      const result = await objectsApi.fetchType(id)
      setFetchResult(result)
      loadInstances()
    } catch (err) {
      setFetchResult({ error: err.message })
    } finally {
      setFetching(false)
    }
  }

  const selectedType = types.find(t => t.id === selectedTypeId)

  if (loading) return <div className="text-gray-500 text-sm">Loading…</div>

  if (showForm) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">New Object Type</h1>
      <TypeForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
    </div>
  )

  if (editType) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">Edit — {editType.name}</h1>
      <TypeForm initial={editType} onSave={handleUpdate} onCancel={() => setEditType(null)} />
    </div>
  )

  return (
    <div className="flex gap-6 h-full">
      {/* Left panel — type list */}
      <div className="w-64 shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Object Types</h2>
          <button onClick={() => setShowForm(true)}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-1 rounded transition-colors">
            + New
          </button>
        </div>

        {types.length === 0 && (
          <p className="text-xs text-gray-600 italic">No types yet.</p>
        )}

        {types.map(t => (
          <div key={t.id}
            onClick={() => setSearchParams({ type: t.id })}
            className={`p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedTypeId === t.id
                ? 'border-indigo-500 bg-indigo-950'
                : 'border-gray-800 bg-gray-900 hover:border-gray-700'
            }`}>
            <p className="text-sm font-medium truncate">{t.name}</p>
            {t.description && <p className="text-xs text-gray-500 truncate mt-0.5">{t.description}</p>}
            {t.source_url && <p className="text-xs text-gray-600 font-mono truncate mt-1">{t.source_url}</p>}
          </div>
        ))}
      </div>

      {/* Right panel — instances */}
      <div className="flex-1 min-w-0">
        {!selectedTypeId ? (
          <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
            Select an object type to view instances
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4 gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{selectedType?.name}</h2>
                {selectedType?.source_url && (
                  <Badge color="indigo">{selectedType.source_method}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {fetchResult && !fetchResult.error && (
                  <span className="text-xs text-green-400">
                    +{fetchResult.created} created, {fetchResult.skipped} skipped
                  </span>
                )}
                {fetchResult?.error && (
                  <span className="text-xs text-red-400">{fetchResult.error}</span>
                )}
                <button onClick={() => setEditType(selectedType)}
                  className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded transition-colors">
                  Edit
                </button>
                <button onClick={() => handleFetch(selectedTypeId)} disabled={fetching || !selectedType?.source_url}
                  className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded transition-colors">
                  {fetching ? 'Fetching…' : 'Fetch now'}
                </button>
                <button onClick={() => handleDelete(selectedTypeId)}
                  className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-red-900 rounded transition-colors text-gray-400 hover:text-red-300">
                  Delete
                </button>
              </div>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search instances…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              <button type="submit"
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
                Search
              </button>
              {query && (
                <button type="button" onClick={() => { setQuery(''); loadInstances('') }}
                  className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">×</button>
              )}
            </form>

            {instances.length === 0 ? (
              <p className="text-sm text-gray-600 italic">No instances found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {instances.map(inst => <ObjectCard key={inst.id} instance={inst} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
