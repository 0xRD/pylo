import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'
import { fmtDateTime } from '../utils/dates'

export default function EntryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [entry, setEntry] = useState(null)
  const [blueprint, setBlueprint] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('fields')
  const [editValues, setEditValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [history, setHistory] = useState(null)
  const [histLoading, setHistLoading] = useState(false)

  useEffect(() => {
    blueprintsApi.getEntry(id)
      .then(e => {
        setEntry(e)
        return blueprintsApi.getBlueprint(e.blueprint_id)
      })
      .then(bp => {
        setBlueprint(bp)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (tab === 'history' && entry && blueprint && history === null) {
      setHistLoading(true)
      blueprintsApi.getEntryHistory(blueprint.id, entry.id)
        .then(setHistory)
        .catch(() => setHistory([]))
        .finally(() => setHistLoading(false))
    }
  }, [tab, entry, blueprint])

  const handleDelete = async () => {
    if (!confirm('Delete this entry?')) return
    await blueprintsApi.deleteEntry(id)
    navigate('/entries')
  }

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/entries')
  }

  const handleSave = async () => {
    setSaving(true); setSaveError(null)
    try {
      const updated = await blueprintsApi.updateEntry(blueprint.id, entry.id, editValues)
      setEntry(updated)
      setEditValues({})
      setHistory(null)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500 text-sm p-8">Loading…</div>
  if (error) return <div className="text-red-400 text-sm p-8">{error}</div>
  if (!entry) return null

  let data = {}
  let rawData = {}
  try { data = JSON.parse(entry.data) } catch {}
  try { rawData = JSON.parse(entry.raw_data) } catch {}

  const fieldMappings = (() => { try { return JSON.parse(blueprint?.field_mappings || '[]') } catch { return [] } })()
  const mutableMode = blueprint?.mutable_mode || 'none'
  const mutableFields = mutableMode === 'all'
    ? new Set(Object.keys(data))
    : mutableMode === 'per_field'
      ? new Set(fieldMappings.filter(m => m.mutable).map(m => m.field_name))
      : new Set()
  const hasMutable = mutableFields.size > 0
  const hasEdits = Object.keys(editValues).length > 0

  return (
    <div className="max-w-5xl space-y-6 px-4 py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-gray-500">
        <Link to="/entries" className="hover:text-gray-300 transition-colors">Entries</Link>
        <span>›</span>
        {blueprint && (
          <>
            <Link to={`/blueprints/${entry.blueprint_id}`} className="hover:text-gray-300 transition-colors">
              {blueprint.name}
            </Link>
            <span>›</span>
          </>
        )}
        <span className="text-gray-200 font-mono">{entry.id.slice(0, 8)}</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Entry <span className="font-mono text-indigo-400">{entry.id.slice(0, 8)}</span>
          </h1>
          {entry.external_id && (
            <p className="text-sm text-gray-500 mt-1">Key: <span className="font-mono">{entry.external_id}</span></p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goBack}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 transition-colors">
            ← Back
          </button>
          <button onClick={handleDelete} disabled={!isAdmin}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed rounded text-gray-400 hover:text-red-300 transition-colors">
            Delete
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span>Created: {fmtDateTime(entry.created_at)}</span>
        <span>Updated: {fmtDateTime(entry.updated_at)}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-800">
        {['fields', 'raw', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {t === 'history' ? 'History' : t === 'raw' ? 'Raw' : 'Fields'}
          </button>
        ))}
      </div>

      {/* Fields tab */}
      {tab === 'fields' && (
        <section>
          {Object.keys(data).length === 0 ? (
            <p className="text-sm text-gray-600 italic">No mapped fields.</p>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
              {Object.entries(data).map(([k, v]) => {
                const isEditable = hasMutable && mutableFields.has(k) && isAdmin
                const editVal = editValues[k]
                const currentVal = editVal !== undefined ? editVal : (v === null ? '' : String(v))
                return (
                  <div key={k} className="flex gap-4 px-4 py-3 text-sm items-start">
                    <dt className="text-gray-400 w-40 shrink-0 font-mono text-xs pt-1.5">{k}</dt>
                    <dd className="flex-1 min-w-0">
                      {isEditable ? (
                        <input
                          value={currentVal}
                          onChange={e => setEditValues(ev => ({ ...ev, [k]: e.target.value }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
                        />
                      ) : (
                        <span className="text-gray-100 break-all">
                          {v === null ? <span className="text-gray-600">null</span> : String(v)}
                        </span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </div>
          )}
          {hasMutable && isAdmin && (
            <div className="mt-4 flex items-center gap-3">
              <button onClick={handleSave} disabled={saving || !hasEdits}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {hasEdits && (
                <button onClick={() => setEditValues({})}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
                  Discard
                </button>
              )}
              {saveError && <span className="text-xs text-red-400">{saveError}</span>}
            </div>
          )}
        </section>
      )}

      {/* Raw tab */}
      {tab === 'raw' && (
        <section>
          <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-auto max-h-96">
            {JSON.stringify(rawData, null, 2)}
          </pre>
        </section>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <section>
          {histLoading ? (
            <p className="text-sm text-gray-500">Loading history…</p>
          ) : !history || history.length === 0 ? (
            <p className="text-sm text-gray-600 italic">No history recorded.</p>
          ) : (
            <div className="space-y-3">
              {history.map(ev => {
                let oldV = {}, newV = {}, changed = []
                try { oldV = JSON.parse(ev.old_values) } catch {}
                try { newV = JSON.parse(ev.new_values) } catch {}
                try { changed = JSON.parse(ev.changed_fields) } catch {}
                return (
                  <div key={ev.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          ev.event_type === 'created' ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'
                        }`}>{ev.event_type}</span>
                        <span className="text-gray-400 text-xs">{ev.actor === 'API' ? 'via API' : `by ${ev.actor}`}</span>
                      </div>
                      <span className="text-xs text-gray-600">{fmtDateTime(ev.created_at)}</span>
                    </div>
                    {ev.event_type === 'updated' && changed.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {changed.map(field => (
                          <div key={field} className="grid grid-cols-12 gap-2 text-xs">
                            <span className="col-span-3 font-mono text-gray-400 truncate">{field}</span>
                            <span className="col-span-4 text-red-400 line-through truncate">
                              {oldV[field] !== undefined ? String(oldV[field]) : '—'}
                            </span>
                            <span className="col-span-1 text-gray-600 text-center">→</span>
                            <span className="col-span-4 text-green-400 truncate">
                              {newV[field] !== undefined ? String(newV[field]) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {ev.event_type === 'created' && (
                      <p className="text-xs text-gray-500 mt-1">Entry created with {changed.length} fields.</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
