import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { objectsApi } from '../api/objects'
import ObjectCard from '../components/ObjectCard'

function Badge({ children, color = 'gray' }) {
  const cls = {
    gray: 'bg-gray-800 text-gray-300',
    indigo: 'bg-indigo-900 text-indigo-300',
    green: 'bg-green-900 text-green-300',
    red: 'bg-red-900 text-red-300',
  }[color] || 'bg-gray-800 text-gray-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{children}</span>
}

const EMPTY_MAPPING = { source_path: '', field_name: '', field_type: 'string', is_key: false }
const FIELD_TYPES = ['string', 'number', 'boolean', 'datetime']

function TypeForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', description: '', source_url: '', source_method: 'GET',
    source_headers: '{}', source_body: '{}', field_mappings: '[]',
    trigger_pybook_id: '', polling_interval_seconds: '',
    fetch_cron: '', fetch_is_active: false,
  })
  const [mappings, setMappings] = useState(() => {
    try { return JSON.parse(initial?.field_mappings || '[]') } catch { return [] }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const setMapping = (i, k, v) => setMappings(ms => ms.map((m, idx) => idx === i ? { ...m, [k]: v } : m))

  const setKeyField = (i) => {
    setMappings(ms => ms.map((m, idx) => ({ ...m, is_key: idx === i })))
  }

  const hasKey = mappings.some(m => m.is_key)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await onSave({
        ...form,
        field_mappings: JSON.stringify(mappings),
        polling_interval_seconds: form.polling_interval_seconds ? Number(form.polling_interval_seconds) : null,
        trigger_pybook_id: form.trigger_pybook_id || null,
        fetch_cron: form.fetch_cron || null,
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
          <input value={form.source_url || ''} onChange={e => set('source_url', e.target.value)}
            placeholder="https://api.example.com/data"
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

      {/* Auto-fetch schedule */}
      <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-2">
        <label className="block text-xs text-gray-400 font-medium">Auto-fetch schedule</label>
        <div className="flex items-center gap-3">
          <input value={form.fetch_cron || ''} onChange={e => set('fetch_cron', e.target.value)}
            placeholder="*/5 * * * *  (every 5 min)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer shrink-0">
            <input type="checkbox" checked={!!form.fetch_is_active}
              onChange={e => set('fetch_is_active', e.target.checked)}
              className="rounded border-gray-600" />
            Active
          </label>
        </div>
        <p className="text-xs text-gray-600">Leave blank to disable scheduled fetching. Uses standard 5-field cron syntax.</p>
      </div>

      {/* Field mappings */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div>
            <label className="text-xs text-gray-400">Field Mappings</label>
            <span className="text-xs text-gray-600 ml-2">Click ☆ to mark the unique key used for deduplication</span>
          </div>
          <button type="button" onClick={() => setMappings(ms => [...ms, { ...EMPTY_MAPPING }])}
            className="text-xs text-indigo-400 hover:text-indigo-300">+ Add field</button>
        </div>

        {mappings.length > 0 && (
          <div className="grid grid-cols-12 gap-2 mb-1 px-1">
            <span className="col-span-1 text-xs text-gray-600 text-center">Key</span>
            <span className="col-span-4 text-xs text-gray-600">JSONPath</span>
            <span className="col-span-4 text-xs text-gray-600">Field name</span>
            <span className="col-span-2 text-xs text-gray-600">Type</span>
          </div>
        )}

        {mappings.length === 0 && (
          <p className="text-xs text-gray-600 italic">No mappings — raw JSON will be stored only.</p>
        )}

        <div className="space-y-2">
          {mappings.map((m, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <button
                type="button"
                onClick={() => setKeyField(i)}
                title={m.is_key ? 'Unique key field (used for deduplication)' : 'Set as unique key field'}
                className={"col-span-1 flex items-center justify-center h-7 rounded text-sm transition-colors " +
                  (m.is_key
                    ? "text-yellow-400 bg-yellow-900/30 border border-yellow-700"
                    : "text-gray-600 hover:text-gray-400 border border-transparent hover:border-gray-700")}>
                {m.is_key ? "★" : "☆"}
              </button>
              <input value={m.source_path} onChange={e => setMapping(i, 'source_path', e.target.value)}
                placeholder="$.items[*].id"
                className={"col-span-4 bg-gray-800 border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 " +
                  (m.is_key ? "border-yellow-800" : "border-gray-700")} />
              <input value={m.field_name} onChange={e => setMapping(i, 'field_name', e.target.value)}
                placeholder={m.is_key ? "e.g. alert_id" : "field_name"}
                className={"col-span-4 bg-gray-800 border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 " +
                  (m.is_key ? "border-yellow-800" : "border-gray-700")} />
              <select value={m.field_type} onChange={e => setMapping(i, 'field_type', e.target.value)}
                className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
                {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <button type="button" onClick={() => setMappings(ms => ms.filter((_, idx) => idx !== i))}
                className="col-span-1 text-gray-600 hover:text-red-400 text-center text-sm">×</button>
            </div>
          ))}
        </div>

        {mappings.length > 0 && !hasKey && (
          <p className="text-xs text-amber-500 mt-2">
            No unique key selected — duplicates may be created on repeated fetches. Click ☆ on the identifier field to set it as the key.
          </p>
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

  const keyField = (() => {
    if (!selectedType) return null
    try {
      const mappings = JSON.parse(selectedType.field_mappings || '[]')
      const km = mappings.find(m => m.is_key)
      return km ? km.field_name : null
    } catch { return null }
  })()

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

        {types.map(t => {
          const hasCron = t.fetch_cron && t.fetch_is_active
          return (
            <div key={t.id}
              onClick={() => setSearchParams({ type: t.id })}
              className={"p-3 rounded-lg border cursor-pointer transition-colors " +
                (selectedTypeId === t.id
                  ? "border-indigo-500 bg-indigo-950"
                  : "border-gray-800 bg-gray-900 hover:border-gray-700")}>
              <div className="flex items-center justify-between gap-1">
                <p className="text-sm font-medium truncate">{t.name}</p>
                {hasCron && <span className="text-xs text-green-500 shrink-0" title={"Auto-fetch: " + t.fetch_cron}>&#9654;</span>}
              </div>
              {t.description && <p className="text-xs text-gray-500 truncate mt-0.5">{t.description}</p>}
              {t.source_url && <p className="text-xs text-gray-600 font-mono truncate mt-1">{t.source_url}</p>}
            </div>
          )
        })}
      </div>

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
                {keyField && (
                  <span className="text-xs text-yellow-500 font-mono" title="Unique key field">
                    ★ {keyField}
                  </span>
                )}
                {selectedType?.fetch_cron && selectedType?.fetch_is_active && (
                  <span className="text-xs text-green-500 font-mono" title="Auto-fetch active">
                    &#9654; {selectedType.fetch_cron}
                  </span>
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
