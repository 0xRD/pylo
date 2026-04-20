import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'
import EntryCard from '../components/EntryCard'

function Badge({ children, color = 'gray' }) {
  const cls = {
    gray: 'bg-gray-800 text-gray-300',
    indigo: 'bg-indigo-900 text-indigo-300',
    green: 'bg-green-900 text-green-300',
    red: 'bg-red-900 text-red-300',
  }[color] || 'bg-gray-800 text-gray-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{children}</span>
}

// ── JSON path builder ─────────────────────────────────────────────────────────

function buildPath(parent, key) {
  if (parent === null) return '$'
  if (typeof key === 'number') return `${parent}[*]`
  return parent === '$' ? `$.${key}` : `${parent}.${key}`
}

function JsonNode({ label, data, path, onSelect, depth }) {
  const [open, setOpen] = useState(depth < 2)
  const isObj = data !== null && typeof data === 'object'
  const isArr = Array.isArray(data)

  const preview = isArr
    ? `[${data.length}]`
    : isObj
    ? `{${Object.keys(data).length}}`
    : JSON.stringify(data)

  return (
    <div className="leading-relaxed">
      <div className="flex items-center gap-1 group">
        {isObj ? (
          <button type="button" onClick={() => setOpen(o => !o)}
            className="text-gray-600 w-3 text-xs shrink-0 hover:text-gray-400">
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-blue-400 text-xs font-mono shrink-0">{label}</span>
        {!isObj && (
          <>
            <span className="text-gray-600 text-xs mx-0.5">:</span>
            <span className="text-green-300 text-xs font-mono truncate max-w-32">{preview}</span>
          </>
        )}
        {isObj && !open && (
          <span className="text-gray-600 text-xs ml-1">{preview}</span>
        )}
        <button type="button"
          onClick={() => onSelect(path)}
          title={"Use path: " + path}
          className="ml-1 text-indigo-500 hover:text-indigo-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          → {path}
        </button>
      </div>

      {isObj && open && (
        <div className="ml-4 border-l border-gray-800 pl-2 mt-0.5">
          {isArr
            ? data.slice(0, 3).map((item, i) => (
                <JsonNode key={i} label={`[${i}]`} data={item}
                  path={buildPath(path, i)} onSelect={onSelect} depth={depth + 1} />
              ))
            : Object.entries(data).map(([k, v]) => (
                <JsonNode key={k} label={k} data={v}
                  path={buildPath(path, k)} onSelect={onSelect} depth={depth + 1} />
              ))
          }
          {isArr && data.length > 3 && (
            <span className="text-xs text-gray-600 pl-1">… {data.length - 3} more</span>
          )}
        </div>
      )}
    </div>
  )
}

function JsonTree({ data, onSelect }) {
  const root = Array.isArray(data) ? data[0] : data
  const label = Array.isArray(data) ? `[0] (of ${data.length})` : 'response'
  return (
    <div className="font-mono text-xs overflow-auto max-h-72 pr-1">
      <JsonNode label={label} data={root} path="$" onSelect={onSelect} depth={0} />
    </div>
  )
}

// ── Blueprint form ────────────────────────────────────────────────────────────

const EMPTY_MAPPING = { source_path: '', field_name: '', field_type: 'string', is_key: false }
const FIELD_TYPES = ['string', 'number', 'boolean', 'datetime']

function BlueprintForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', description: '', source_url: '', source_method: 'GET',
    source_headers: '{}', source_body: '{}', field_mappings: '[]',
    trigger_pybook_id: '', polling_interval_seconds: '',
    fetch_cron: '', fetch_is_active: false, is_manual: false,
  })
  const [mappings, setMappings] = useState(() => {
    try { return JSON.parse(initial?.field_mappings || '[]') } catch { return [] }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [focusedRow, setFocusedRow] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setMapping = (i, k, v) => setMappings(ms => ms.map((m, idx) => idx === i ? { ...m, [k]: v } : m))
  const setKeyField = (i) => setMappings(ms => ms.map((m, idx) => ({ ...m, is_key: idx === i })))
  const hasKey = mappings.some(m => m.is_key)

  const handlePreview = async () => {
    setPreviewing(true); setPreviewResult(null); setPreviewError(null)
    try {
      const result = await blueprintsApi.previewEndpoint({
        source_url: form.source_url,
        source_method: form.source_method,
        source_headers: form.source_headers || '{}',
        source_body: form.source_body || '{}',
        sample_limit: 1,
      })
      setPreviewResult(result)
    } catch (err) {
      setPreviewError(err.message)
    } finally {
      setPreviewing(false)
    }
  }

  const handlePathSelect = (path) => {
    if (focusedRow !== null) {
      setMapping(focusedRow, 'source_path', path)
    } else {
      setMappings(ms => [...ms, { ...EMPTY_MAPPING, source_path: path }])
    }
  }

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
    } catch (err) { setError(err.message); setSaving(false) }
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

      {/* Manual blueprint toggle */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input type="checkbox" checked={!!form.is_manual} onChange={e => set('is_manual', e.target.checked)}
          className="rounded border-gray-600" />
        <span className="text-sm text-gray-300">Manual blueprint</span>
        <span className="text-xs text-gray-600">Entries are created manually — no API source needed</span>
      </label>

      {!form.is_manual && (
        <>
          {/* URL + Test */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Source URL</label>
            <div className="flex gap-2">
              <div className="flex flex-1 gap-2">
                <input value={form.source_url || ''} onChange={e => set('source_url', e.target.value)}
                  placeholder="https://api.example.com/data"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
                <select value={form.source_method} onChange={e => set('source_method', e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
                  <option>GET</option><option>POST</option>
                </select>
              </div>
              <button type="button" onClick={handlePreview} disabled={!form.source_url || previewing}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-sm transition-colors shrink-0">
                {previewing ? 'Testing…' : 'Test'}
              </button>
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

          {/* Preview panel */}
          {previewError && (
            <div className="p-3 bg-red-950 border border-red-800 rounded text-xs text-red-300">{previewError}</div>
          )}
          {previewResult && (
            <div className="p-3 bg-gray-950 border border-gray-700 rounded space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-green-400">HTTP {previewResult.status_code}</span>
                <span className="text-xs text-gray-400">
                  {previewResult.is_list
                    ? `List of ${previewResult.total} items — showing first item`
                    : 'Single object response'}
                </span>
                <span className="text-xs text-gray-600 ml-auto">
                  {focusedRow !== null
                    ? `Click a path to fill row ${focusedRow + 1}`
                    : 'Click a path to add a new mapping'}
                </span>
              </div>
              <JsonTree data={previewResult.sample} onSelect={handlePathSelect} />
            </div>
          )}

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
            <p className="text-xs text-gray-600">Leave blank to disable scheduled fetching. 5-field cron syntax.</p>
          </div>
        </>
      )}

      {/* Field mappings */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div>
            <label className="text-xs text-gray-400">Field Mappings</label>
            <span className="text-xs text-gray-600 ml-2">
              {previewResult && !form.is_manual
                ? 'Click a row to focus it, then click a path in the tree above'
                : 'Click ☆ to set the unique key for deduplication'}
            </span>
          </div>
          <button type="button"
            onClick={() => { setMappings(ms => [...ms, { ...EMPTY_MAPPING }]); setFocusedRow(mappings.length) }}
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

        <div className="space-y-1.5">
          {mappings.map((m, i) => (
            <div key={i} onClick={() => setFocusedRow(i)}
              className={"grid grid-cols-12 gap-2 items-center rounded p-0.5 cursor-pointer " +
                (focusedRow === i ? "bg-indigo-950/40 ring-1 ring-indigo-700" : "hover:bg-gray-900")}>
              <button type="button" onClick={e => { e.stopPropagation(); setKeyField(i) }}
                title={m.is_key ? 'Unique key field' : 'Set as unique key field'}
                className={"col-span-1 flex items-center justify-center h-7 rounded text-sm transition-colors " +
                  (m.is_key
                    ? "text-yellow-400 bg-yellow-900/30 border border-yellow-700"
                    : "text-gray-600 hover:text-gray-400 border border-transparent hover:border-gray-700")}>
                {m.is_key ? "★" : "☆"}
              </button>
              <input value={m.source_path} onChange={e => setMapping(i, 'source_path', e.target.value)}
                onClick={e => { e.stopPropagation(); setFocusedRow(i) }}
                placeholder="$.id"
                className={"col-span-4 bg-gray-800 border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 " +
                  (m.is_key ? "border-yellow-800" : "border-gray-700")} />
              <input value={m.field_name} onChange={e => setMapping(i, 'field_name', e.target.value)}
                onClick={e => { e.stopPropagation(); setFocusedRow(i) }}
                placeholder={m.is_key ? "e.g. alert_id" : "field_name"}
                className={"col-span-4 bg-gray-800 border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 " +
                  (m.is_key ? "border-yellow-800" : "border-gray-700")} />
              <select value={m.field_type} onChange={e => setMapping(i, 'field_type', e.target.value)}
                className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
                {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <button type="button"
                onClick={e => { e.stopPropagation(); setMappings(ms => ms.filter((_, idx) => idx !== i)); if (focusedRow === i) setFocusedRow(null) }}
                className="col-span-1 text-gray-600 hover:text-red-400 text-center text-sm">×</button>
            </div>
          ))}
        </div>

        {mappings.length > 0 && !hasKey && (
          <p className="text-xs text-amber-500 mt-2">
            No unique key set — duplicates may be created on repeated fetches. Click ☆ on the identifier field.
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

// ── Main Blueprints page ──────────────────────────────────────────────────────

export default function Blueprints() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('blueprint')

  const [blueprints, setBlueprints] = useState([])
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editBlueprint, setEditBlueprint] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadBlueprints = () => blueprintsApi.listBlueprints().then(setBlueprints).catch(console.error)
  const loadEntries = (q = query) =>
    blueprintsApi.listEntries({ blueprintId: selectedId, q: q || undefined }).then(setEntries).catch(console.error)

  useEffect(() => { loadBlueprints().then(() => setLoading(false)) }, [])
  useEffect(() => { if (selectedId) loadEntries() }, [selectedId])

  const handleSearch = (e) => { e.preventDefault(); loadEntries(query) }
  const handleCreate = async (data) => { await blueprintsApi.createBlueprint(data); setShowForm(false); loadBlueprints() }
  const handleUpdate = async (data) => { await blueprintsApi.updateBlueprint(editBlueprint.id, data); setEditBlueprint(null); loadBlueprints() }

  const handleDelete = async (id) => {
    if (!confirm('Delete this blueprint and all its entries?')) return
    await blueprintsApi.deleteBlueprint(id)
    if (selectedId === id) setSearchParams({})
    loadBlueprints()
    setEntries([])
  }

  const handleFetch = async (id) => {
    setFetching(true); setFetchResult(null)
    try { const r = await blueprintsApi.fetchBlueprint(id); setFetchResult(r); loadEntries() }
    catch (err) { setFetchResult({ error: err.message }) }
    finally { setFetching(false) }
  }

  const selectedBlueprint = blueprints.find(b => b.id === selectedId)

  const keyField = (() => {
    if (!selectedBlueprint) return null
    try {
      const km = JSON.parse(selectedBlueprint.field_mappings || '[]').find(m => m.is_key)
      return km?.field_name ?? null
    }
    catch { return null }
  })()

  if (loading) return <div className="text-gray-500 text-sm">Loading…</div>

  if (showForm) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">New Blueprint</h1>
      <BlueprintForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
    </div>
  )

  if (editBlueprint) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">Edit — {editBlueprint.name}</h1>
      <BlueprintForm initial={editBlueprint} onSave={handleUpdate} onCancel={() => setEditBlueprint(null)} />
    </div>
  )

  return (
    <div className="flex gap-6 h-full">
      {/* Sidebar: blueprint list */}
      <div className="w-64 shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Blueprints</h2>
          <button onClick={() => setShowForm(true)}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-1 rounded transition-colors">+ New</button>
        </div>
        {blueprints.length === 0 && <p className="text-xs text-gray-600 italic">No blueprints yet.</p>}
        {blueprints.map(b => (
          <div key={b.id} onClick={() => setSearchParams({ blueprint: b.id })}
            className={"p-3 rounded-lg border cursor-pointer transition-colors " +
              (selectedId === b.id ? "border-indigo-500 bg-indigo-950" : "border-gray-800 bg-gray-900 hover:border-gray-700")}>
            <div className="flex items-center justify-between gap-1">
              <p className="text-sm font-medium truncate">{b.name}</p>
              <div className="flex items-center gap-1 shrink-0">
                {b.is_manual && <span className="text-xs text-gray-500" title="Manual blueprint">✎</span>}
                {b.fetch_cron && b.fetch_is_active && (
                  <span className="text-xs text-green-500" title={"Auto-fetch: " + b.fetch_cron}>▶</span>
                )}
              </div>
            </div>
            {b.description && <p className="text-xs text-gray-500 truncate mt-0.5">{b.description}</p>}
            {!b.is_manual && b.source_url && (
              <p className="text-xs text-gray-600 font-mono truncate mt-1">{b.source_url}</p>
            )}
            {b.is_manual && (
              <p className="text-xs text-gray-600 mt-1">manual</p>
            )}
          </div>
        ))}
      </div>

      {/* Main panel: entries */}
      <div className="flex-1 min-w-0">
        {!selectedId ? (
          <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
            Select a blueprint to view entries
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4 gap-4">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-lg font-semibold">{selectedBlueprint?.name}</h2>
                {selectedBlueprint?.is_manual
                  ? <Badge color="gray">manual</Badge>
                  : selectedBlueprint?.source_url && <Badge color="indigo">{selectedBlueprint.source_method}</Badge>
                }
                {keyField && <span className="text-xs text-yellow-500 font-mono" title="Unique key">★ {keyField}</span>}
                {selectedBlueprint?.fetch_cron && selectedBlueprint?.fetch_is_active && (
                  <span className="text-xs text-green-500 font-mono">▶ {selectedBlueprint.fetch_cron}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {fetchResult && !fetchResult.error && (
                  <span className="text-xs text-green-400">+{fetchResult.created} created, {fetchResult.skipped} skipped</span>
                )}
                {fetchResult?.error && <span className="text-xs text-red-400">{fetchResult.error}</span>}
                <button onClick={() => setEditBlueprint(selectedBlueprint)}
                  className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded transition-colors">Edit</button>
                {!selectedBlueprint?.is_manual && (
                  <button onClick={() => handleFetch(selectedId)} disabled={fetching || !selectedBlueprint?.source_url}
                    className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded transition-colors">
                    {fetching ? 'Fetching…' : 'Fetch now'}
                  </button>
                )}
                <button onClick={() => handleDelete(selectedId)}
                  className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-red-900 rounded transition-colors text-gray-400 hover:text-red-300">Delete</button>
              </div>
            </div>

            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search entries…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              <button type="submit" className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">Search</button>
              {query && <button type="button" onClick={() => { setQuery(''); loadEntries('') }}
                className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">×</button>}
            </form>

            {entries.length === 0
              ? <p className="text-sm text-gray-600 italic">No entries found.</p>
              : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {entries.map(e => <EntryCard key={e.id} entry={e} />)}
                </div>
            }
          </>
        )}
      </div>
    </div>
  )
}
