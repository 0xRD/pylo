import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { activityApi } from '../api/activity'
import { fmtDateTime } from '../utils/dates'

const CATEGORY_COLORS = {
  auth:      'bg-indigo-900/50 text-indigo-300 border-indigo-700',
  blueprint: 'bg-blue-900/50 text-blue-300 border-blue-700',
  pybook:    'bg-green-900/50 text-green-300 border-green-700',
  entry:     'bg-cyan-900/50 text-cyan-300 border-cyan-700',
  user:      'bg-purple-900/50 text-purple-300 border-purple-700',
  secret:    'bg-red-900/50 text-red-300 border-red-700',
  invite:    'bg-orange-900/50 text-orange-300 border-orange-700',
  settings:  'bg-gray-800 text-gray-400 border-gray-600',
}

const CATEGORIES = ['auth', 'blueprint', 'pybook', 'entry', 'user', 'secret', 'invite', 'settings']

const EVENT_TYPES_BY_CATEGORY = {
  auth:      ['auth.login', 'auth.logout', 'auth.login_failed'],
  blueprint: ['blueprint.created', 'blueprint.updated', 'blueprint.deleted', 'blueprint.fetch'],
  pybook:    ['pybook.run', 'pybook.created', 'pybook.updated', 'pybook.deleted'],
  entry:     ['entry.created', 'entry.deleted', 'entry.bulk_deleted'],
  user:      ['user.created', 'user.updated', 'user.deleted'],
  secret:    ['secret.created', 'secret.deleted'],
  invite:    ['invite.created', 'invite.used', 'invite.revoked'],
  settings:  ['settings.updated'],
}

const PAGE_SIZE = 50

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function ResourceLink({ event }) {
  const { resource_type, resource_id, resource_name } = event
  if (!resource_id || !resource_name) return resource_name ? <span className="text-gray-300">{resource_name}</span> : null
  if (resource_type === 'blueprint') {
    return <Link to={`/blueprints/${resource_id}`} className="text-blue-400 hover:underline">{resource_name}</Link>
  }
  if (resource_type === 'pybook') {
    return <Link to="/pybooks" className="text-green-400 hover:underline">{resource_name}</Link>
  }
  return <span className="text-gray-300">{resource_name}</span>
}

function DetailPanel({ detail }) {
  if (!detail || Object.keys(detail).length === 0) return null
  return (
    <pre className="mt-2 ml-4 bg-gray-950 border border-gray-800 rounded p-2 text-xs text-gray-400 font-mono whitespace-pre-wrap overflow-auto max-h-48">
      {JSON.stringify(detail, null, 2)}
    </pre>
  )
}

function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = event.detail && Object.keys(event.detail).length > 0
  const badgeClass = CATEGORY_COLORS[event.category] || 'bg-gray-800 text-gray-400 border-gray-600'
  const isFailed = event.event_type === 'pybook.run' && event.detail?.exit_code !== 0 && event.detail?.exit_code != null

  return (
    <div className={`border rounded-lg px-4 py-3 transition-colors ${
      isFailed ? 'border-red-900 bg-red-950/20' : 'border-gray-800 bg-gray-900 hover:border-gray-700'
    }`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500 w-16 shrink-0" title={fmtDateTime(event.created_at)}>
          {relativeTime(event.created_at)}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${badgeClass}`}>
          {event.category}
        </span>
        <span className="text-xs font-mono text-gray-300 shrink-0">{event.event_type}</span>
        <span className="text-xs text-gray-500 shrink-0">by <span className="text-gray-400">{event.actor}</span></span>
        {(event.resource_name || event.resource_id) && (
          <span className="text-xs text-gray-600 shrink-0">→ <ResourceLink event={event} /></span>
        )}
        {isFailed && (
          <span className="text-xs text-red-400 ml-auto shrink-0">exit {event.detail.exit_code}</span>
        )}
        {hasDetail && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-600 hover:text-gray-400 ml-auto shrink-0"
          >
            {expanded ? '▲ hide' : '▼ detail'}
          </button>
        )}
      </div>
      {expanded && <DetailPanel detail={event.detail} />}
    </div>
  )
}

const PRESETS = [
  { label: 'Failed runs', params: { event_type: 'pybook.run' }, failedOnly: true },
  { label: 'Auth events', params: { category: 'auth' } },
  { label: 'Config changes', params: { category: 'blueprint' } },
  { label: 'Today', params: { from: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() } },
]

export default function Activity() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const [filters, setFilters] = useState({
    category: '',
    event_type: '',
    actor: '',
    resource_name: '',
    resource_id: '',
    from: '',
    to: '',
  })
  const [failedOnly, setFailedOnly] = useState(false)
  const [activePreset, setActivePreset] = useState(null)
  // applied = what's sent to the API; filters = what the inputs show
  const [applied, setApplied] = useState(filters)
  const debounceRef = useRef(null)

  const buildParams = useCallback((extraOffset = 0) => {
    const p = { limit: PAGE_SIZE, offset: extraOffset }
    if (applied.event_type) p.event_type = applied.event_type
    else if (applied.category) p.category = applied.category
    if (applied.actor) p.actor = applied.actor
    if (applied.resource_name) p.resource_name = applied.resource_name
    if (applied.resource_id) p.resource_id = applied.resource_id
    if (applied.from) p.from = applied.from
    if (applied.to) p.to = applied.to
    return p
  }, [applied])

  const load = useCallback(async () => {
    setLoading(true)
    setOffset(0)
    try {
      const data = await activityApi.list(buildParams(0))
      let fetched = data.items
      if (failedOnly) fetched = fetched.filter(e => e.detail?.exit_code != null && e.detail.exit_code !== 0)
      setItems(fetched)
      setTotal(data.total)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [buildParams, failedOnly])

  const loadMore = async () => {
    const newOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    try {
      const data = await activityApi.list(buildParams(newOffset))
      let fetched = data.items
      if (failedOnly) fetched = fetched.filter(e => e.detail?.exit_code != null && e.detail.exit_code !== 0)
      setItems(prev => [...prev, ...fetched])
      setOffset(newOffset)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => { load() }, [load])

  const applyPreset = (preset, idx) => {
    setActivePreset(idx)
    setFailedOnly(!!preset.failedOnly)
    const next = {
      category: preset.params.category || '',
      event_type: preset.params.event_type || '',
      actor: '',
      resource_name: '',
      resource_id: '',
      from: preset.params.from || '',
      to: '',
    }
    setFilters(next)
    setApplied(next)
  }

  const clearFilters = () => {
    setActivePreset(null)
    setFailedOnly(false)
    const empty = { category: '', event_type: '', actor: '', resource_name: '', resource_id: '', from: '', to: '' }
    setFilters(empty)
    setApplied(empty)
  }

  const TEXT_FILTERS = new Set(['actor', 'resource_name', 'resource_id'])

  const setFilter = (key, val) => {
    setActivePreset(null)
    const next = { ...filters, [key]: val, ...(key === 'category' ? { event_type: '' } : {}) }
    setFilters(next)
    if (TEXT_FILTERS.has(key)) {
      // debounce text inputs — apply after 400ms idle
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => setApplied(next), 400)
    } else {
      setApplied(next)
    }
  }

  const availableTypes = filters.category ? (EVENT_TYPES_BY_CATEGORY[filters.category] || []) : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activity</h1>
        <span className="text-xs text-gray-500">{total} events</span>
      </div>

      {/* Preset shortcuts */}
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p, i)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              activePreset === i
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        {(activePreset !== null || Object.values(filters).some(Boolean)) && (
          <button onClick={clearFilters} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-300">
            Clear
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-3">
        {/* Category chips */}
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter('category', filters.category === cat ? '' : cat)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                filters.category === cat
                  ? (CATEGORY_COLORS[cat] || 'bg-gray-700 text-white border-gray-500')
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Event type */}
          {availableTypes.length > 0 ? (
            <select
              value={filters.event_type}
              onChange={e => setFilter('event_type', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All event types</option>
              {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <input
              type="text"
              placeholder="event_type (e.g. pybook.run)"
              value={filters.event_type}
              onChange={e => setFilter('event_type', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-52"
            />
          )}

          {/* Actor */}
          <input
            type="text"
            placeholder="actor"
            value={filters.actor}
            onChange={e => setFilter('actor', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-32"
          />

          {/* Resource name */}
          <input
            type="text"
            placeholder="resource name (e.g. Lol Drivers)"
            value={filters.resource_name}
            onChange={e => setFilter('resource_name', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-52"
          />

          {/* Resource ID */}
          <input
            type="text"
            placeholder="resource ID (UUID)"
            value={filters.resource_id}
            onChange={e => setFilter('resource_id', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-44"
          />

          {/* Date range presets */}
          <select
            onChange={e => {
              const val = e.target.value
              if (!val) { setFilter('from', ''); return }
              const now = new Date()
              const fromMap = {
                '1h':  new Date(now - 3600000).toISOString(),
                '24h': new Date(now - 86400000).toISOString(),
                '7d':  new Date(now - 7 * 86400000).toISOString(),
              }
              setFilter('from', fromMap[val] || '')
            }}
            defaultValue=""
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">All time</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
          </select>
        </div>
      </div>

      {/* Event feed */}
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-600 italic">No events found.</p>
      ) : (
        <div className="space-y-1">
          {items.map(event => <EventRow key={event.id} event={event} />)}
        </div>
      )}

      {!loading && items.length < total && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs px-4 py-2 bg-gray-800 border border-gray-700 rounded hover:border-gray-500 text-gray-400 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? 'Loading…' : `Load more (${total - items.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  )
}
