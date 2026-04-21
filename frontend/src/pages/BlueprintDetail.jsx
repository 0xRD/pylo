import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'
import BlueprintForm from '../components/BlueprintForm'
import EntryCard from '../components/EntryCard'

function AddEntryModal({ blueprint, onSave, onClose }) {
  const fieldMappings = (() => { try { return JSON.parse(blueprint.field_mappings || '[]') } catch { return [] } })()
  const [values, setValues] = useState(() => Object.fromEntries(fieldMappings.map(m => [m.field_name, ''])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''))
      await onSave(cleaned)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-xl p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-gray-100 mb-4">Add Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded">{error}</p>}
          {fieldMappings.length === 0 ? (
            <p className="text-sm text-gray-500">No field mappings defined. Entries will be stored as empty.</p>
          ) : (
            fieldMappings.map(m => (
              <div key={m.field_name}>
                <label className="block text-xs text-gray-400 mb-1">
                  {m.field_name}
                  {m.is_key && <span className="ml-1 text-yellow-500 text-xs">★ key</span>}
                </label>
                <input
                  value={values[m.field_name] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [m.field_name]: e.target.value }))}
                  placeholder={m.field_type}
                  required={m.is_key}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            ))
          )}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
              {saving ? 'Saving…' : 'Add Entry'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function BlueprintDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('entries')
  const [blueprint, setBlueprint] = useState(null)
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [showAddEntry, setShowAddEntry] = useState(false)

  const loadBlueprint = () => blueprintsApi.getBlueprint(id).then(setBlueprint).catch(() => navigate('/blueprints'))
  const loadEntries = (q = query) =>
    blueprintsApi.listEntries({ blueprintId: id, q: q || undefined }).then(setEntries).catch(() => {})

  useEffect(() => {
    Promise.all([loadBlueprint(), loadEntries()]).finally(() => setLoading(false))
  }, [id])

  const handleFetch = async () => {
    setFetching(true); setFetchResult(null)
    try {
      const r = await blueprintsApi.fetchBlueprint(id)
      setFetchResult(r)
      loadEntries()
    } catch (err) {
      setFetchResult({ error: err.message })
    } finally {
      setFetching(false)
    }
  }

  const handleUpdate = async (data) => {
    await blueprintsApi.updateBlueprint(id, data)
    await loadBlueprint()
    setTab('entries')
  }

  const handleDelete = async () => {
    if (!confirm(`Delete blueprint "${blueprint?.name}" and all its entries? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await blueprintsApi.deleteBlueprint(id)
      navigate('/blueprints')
    } catch {
      setDeleting(false)
    }
  }

  const handleSearch = (e) => { e.preventDefault(); loadEntries(query) }

  const handleAddEntry = async (fields) => {
    await blueprintsApi.createEntry(id, fields)
    setShowAddEntry(false)
    loadEntries()
  }

  const keyField = (() => {
    try {
      const km = JSON.parse(blueprint?.field_mappings || '[]').find(m => m.is_key)
      return km?.field_name ?? null
    } catch { return null }
  })()

  if (loading) return <div className="text-gray-500 text-sm p-8">Loading…</div>

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-gray-500 mb-5">
        <Link to="/blueprints" className="hover:text-gray-300 transition-colors">Blueprints</Link>
        <span>›</span>
        <span className="text-gray-200">{blueprint?.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h1 className="text-xl font-semibold text-gray-100 truncate">{blueprint?.name}</h1>
          {blueprint?.is_manual
            ? <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-300">manual</span>
            : <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300">API</span>
          }
          {keyField && (
            <span className="shrink-0 text-xs text-yellow-500 font-mono" title="Unique key field">★ {keyField}</span>
          )}
          {blueprint?.fetch_is_active && blueprint?.fetch_cron && (
            <span className="shrink-0 text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">⏱ scheduled</span>
          )}
        </div>
        {blueprint?.description && (
          <p className="text-sm text-gray-500 truncate hidden sm:block">{blueprint.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-800 mb-6">
        {['entries', 'settings'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* Entries tab */}
      {tab === 'entries' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <form onSubmit={handleSearch} className="flex gap-2 flex-1">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search entries…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              <button type="submit"
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
                Search
              </button>
              {query && (
                <button type="button" onClick={() => { setQuery(''); loadEntries('') }}
                  className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">×</button>
              )}
            </form>

            <div className="flex items-center gap-2 shrink-0">
              {fetchResult && !fetchResult.error && (
                <span className="text-xs text-green-400">
                  +{fetchResult.created} created, {fetchResult.skipped} skipped
                </span>
              )}
              {fetchResult?.error && (
                <span className="text-xs text-red-400">{fetchResult.error}</span>
              )}
              {blueprint?.is_manual ? (
                <button onClick={() => setShowAddEntry(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition-colors">
                  + Add entry
                </button>
              ) : (
                <button onClick={handleFetch}
                  disabled={fetching || !blueprint?.source_url}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-sm font-medium transition-colors">
                  {fetching ? 'Fetching…' : 'Fetch now'}
                </button>
              )}
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="text-center py-16 text-gray-600">
              <p className="text-sm">
                {blueprint?.is_manual
                  ? 'No entries yet. Click "+ Add entry" to create one.'
                  : 'No entries yet. Use "Fetch now" to pull data from the source URL.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {entries.map(e => <EntryCard key={e.id} entry={e} />)}
            </div>
          )}
        </div>
      )}

      {/* Settings tab */}
      {tab === 'settings' && blueprint && (
        <div className="space-y-8">
          <BlueprintForm
            initial={blueprint}
            onSave={handleUpdate}
            onCancel={() => setTab('entries')}
          />

          <div className="border-t border-gray-800 pt-6">
            <h3 className="text-sm font-medium text-red-400 mb-3">Danger zone</h3>
            <div className="flex items-center justify-between p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <div>
                <p className="text-sm text-gray-200">Delete this blueprint</p>
                <p className="text-xs text-gray-500 mt-0.5">Permanently deletes the blueprint and all its entries. Cannot be undone.</p>
              </div>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-sm font-medium transition-colors shrink-0 ml-4">
                {deleting ? 'Deleting…' : 'Delete blueprint'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddEntry && blueprint && (
        <AddEntryModal
          blueprint={blueprint}
          onSave={handleAddEntry}
          onClose={() => setShowAddEntry(false)}
        />
      )}
    </div>
  )
}
