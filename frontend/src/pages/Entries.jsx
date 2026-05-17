import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckSquare, Play, Search, Trash2, X } from 'lucide-react'
import { blueprintsApi } from '../api/blueprints'
import { pybooksApi } from '../api/pybooks'
import EntryCard from '../components/EntryCard'
import SearchHelp from '../components/SearchHelp'
import { useAuth } from '../context/AuthContext'

const PAGE_SIZE_OPTIONS = [25, 48, 100, 200]
const DEFAULT_PAGE_SIZE = 48

function parseSortValue(value) {
  if (!value) return {}
  const [sortBy, sortDir = 'desc'] = value.split(':')
  return { sortBy, sortDir }
}

function datetimeFieldsForBlueprint(blueprint) {
  if (!blueprint) return []
  try {
    const mappings = JSON.parse(blueprint.field_mappings || '[]')
    return mappings
      .filter(m => m.field_type === 'datetime' && m.field_name)
      .map(m => m.field_name)
  } catch {
    return []
  }
}

export default function Entries() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [blueprints, setBlueprints] = useState([])
  const [pybooks, setPybooks] = useState([])
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(null)
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') || '')
  const [blueprintFilter, setBlueprintFilter] = useState(searchParams.get('blueprint') || '')
  const [sortValue, setSortValue] = useState(searchParams.get('sort') || '')
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [runPybookId, setRunPybookId] = useState('')
  const [runningSelected, setRunningSelected] = useState(false)
  const [runMessage, setRunMessage] = useState('')
  const { isAdmin } = useAuth()

  useEffect(() => {
    blueprintsApi.listBlueprints().then(setBlueprints).catch(() => {})
    pybooksApi.list().then(data => setPybooks(data.filter(pb => pb.is_active))).catch(() => {})
  }, [])

  const blueprintMap = Object.fromEntries(blueprints.map(b => [b.id, b.name]))
  const selectedBlueprint = blueprints.find(b => b.id === blueprintFilter)
  const sortOptions = useMemo(() => {
    const options = [
      { value: '', label: 'Default' },
      { value: 'created_at:desc', label: 'Created newest' },
      { value: 'created_at:asc', label: 'Created oldest' },
      { value: 'updated_at:desc', label: 'Updated newest' },
      { value: 'updated_at:asc', label: 'Updated oldest' },
    ]
    for (const field of datetimeFieldsForBlueprint(selectedBlueprint)) {
      options.push({ value: `${field}:asc`, label: `${field} oldest` })
      options.push({ value: `${field}:desc`, label: `${field} newest` })
    }
    return options
  }, [selectedBlueprint])

  useEffect(() => {
    if (sortValue && !sortOptions.some(o => o.value === sortValue)) {
      setSortValue('')
      setOffset(0)
    }
  }, [sortOptions, sortValue])

  const load = useCallback((q, bpId, sort, off, ps) => {
    setLoading(true)
    blueprintsApi.listEntries({
      blueprintId: bpId || undefined,
      q: q || undefined,
      limit: ps,
      ...parseSortValue(sort),
      offset: off,
    })
      .then(data => {
        setEntries(Array.isArray(data) ? data : (data.items ?? data))
        setTotal(data.total ?? null)
        setSelectedIds(new Set())
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(query, blueprintFilter, sortValue, offset, pageSize)
  }, [query, blueprintFilter, sortValue, offset, pageSize, load])

  const handleSearch = (e) => {
    e.preventDefault()
    setOffset(0)
    setQuery(draftQuery)
    const p = {}
    if (draftQuery) p.q = draftQuery
    if (blueprintFilter) p.blueprint = blueprintFilter
    if (sortValue) p.sort = sortValue
    setSearchParams(p)
  }

  const handleBlueprintFilter = (id) => {
    const next = id === blueprintFilter ? '' : id
    setBlueprintFilter(next)
    setOffset(0)
    setQuery(draftQuery)
    const p = {}
    if (draftQuery) p.q = draftQuery
    if (next) p.blueprint = next
    if (sortValue) p.sort = sortValue
    setSearchParams(p)
  }

  const handleSortChange = (value) => {
    setSortValue(value)
    setOffset(0)
    const p = {}
    if (draftQuery) p.q = draftQuery
    if (blueprintFilter) p.blueprint = blueprintFilter
    if (value) p.sort = value
    setSearchParams(p)
  }

  const clearFilters = () => {
    setDraftQuery(''); setQuery(''); setBlueprintFilter(''); setSortValue(''); setOffset(0); setSearchParams({})
  }

  const totalPages = total !== null ? Math.ceil(total / pageSize) : null
  const currentPage = Math.floor(offset / pageSize) + 1

  const hasFilter = query || blueprintFilter || sortValue
  const selectedCount = selectedIds.size
  const allVisibleSelected = entries.length > 0 && entries.every(e => selectedIds.has(e.id))

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) entries.forEach(e => next.delete(e.id))
      else entries.forEach(e => next.add(e.id))
      return next
    })
  }

  const deleteSelected = async () => {
    if (!selectedCount || !confirm(`Delete ${selectedCount} selected entr${selectedCount === 1 ? 'y' : 'ies'}?`)) return
    await Promise.all([...selectedIds].map(id => blueprintsApi.deleteEntry(id)))
    setSelectedIds(new Set())
    load(query, blueprintFilter, sortValue, offset, pageSize)
  }

  const runOnSelected = async () => {
    if (!runPybookId || selectedCount === 0) return
    if (!confirm(`Run selected PyBook on ${selectedCount} entr${selectedCount === 1 ? 'y' : 'ies'}?`)) return
    setRunningSelected(true); setRunMessage('')
    try {
      const selectedEntries = entries.filter(e => selectedIds.has(e.id))
      await Promise.all(selectedEntries.map(entry => {
        let entryData = {}
        try { entryData = JSON.parse(entry.data || '{}') } catch {}
        return pybooksApi.run(runPybookId, {
          blueprint_id: entry.blueprint_id,
          entry_id: entry.id,
          entry_data: entryData,
        }, 'entries_bulk')
      }))
      setRunMessage(`${selectedEntries.length} run${selectedEntries.length === 1 ? '' : 's'} queued`)
      setSelectedIds(new Set())
    } catch (err) {
      setRunMessage(err.message)
    } finally {
      setRunningSelected(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#f8f8f2] tracking-tight">Entries</h1>
          <p className="text-sm text-[#6272a4] mt-1">
            {total !== null
              ? `${total} entr${total === 1 ? 'y' : 'ies'}${hasFilter ? ' matching filters' : ''}`
              : 'All entries across blueprints'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#6272a4]">Per page</span>
            {PAGE_SIZE_OPTIONS.map(n => (
              <button key={n} onClick={() => { setPageSize(n); setOffset(0) }}
                className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
                  n === pageSize
                    ? 'bg-[#bd93f9] text-[#191a21]'
                    : 'bg-[#282a36] hover:bg-[#343746] text-[#a7abc4]'
                }`}>
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#6272a4]">Sort</span>
            <select value={sortValue} onChange={e => handleSortChange(e.target.value)}
              className="rounded-md border border-[#343746] bg-[#191a21] px-2 py-1 text-xs text-[#f8f8f2] outline-none focus:border-[#bd93f9]">
              {sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {hasFilter && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs text-[#ff79c6] hover:text-[#ffb86c] transition-colors">
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Blueprint filter chips */}
      {blueprints.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {blueprints.map(bp => (
            <button key={bp.id} onClick={() => handleBlueprintFilter(bp.id)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                blueprintFilter === bp.id
                  ? 'bg-[#44475a] border-[#bd93f9] text-[#f8f8f2]'
                  : 'bg-[#191a21] border-[#343746] text-[#a7abc4] hover:border-[#6272a4] hover:text-[#f8f8f2]'
              }`}>
              {bp.name}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          value={draftQuery}
          onChange={e => setDraftQuery(e.target.value)}
          placeholder="Search entries…"
          className="flex-1 bg-[#191a21] border border-[#343746] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#bd93f9] placeholder:text-[#6272a4]"
        />
        <SearchHelp />
        <button type="submit"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#44475a] hover:bg-[#6272a4] rounded-md text-sm transition-colors">
          <Search size={15} /> Search
        </button>
        {draftQuery && (
          <button type="button" onClick={() => { setDraftQuery(''); setQuery(''); setOffset(0) }}
            className="px-3 py-2 text-[#6272a4] hover:text-[#f8f8f2] text-sm">×</button>
        )}
      </form>

      <div className="mb-5 flex min-h-10 items-center justify-between rounded-md border border-[#343746] bg-[#191a21]/85 px-3 py-2">
        <button onClick={toggleAllVisible}
          className="inline-flex items-center gap-2 text-xs text-[#a7abc4] hover:text-[#f8f8f2] transition-colors">
          <CheckSquare size={15} /> {allVisibleSelected ? 'Clear visible selection' : 'Select visible'}
        </button>
        {selectedCount > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-[#8be9fd]">{selectedCount} selected</span>
            <select value={runPybookId} onChange={e => setRunPybookId(e.target.value)}
              className="rounded-md border border-[#343746] bg-[#0f1117] px-2 py-1.5 text-xs text-[#f8f8f2] outline-none focus:border-[#8be9fd]">
              <option value="">Run PyBook…</option>
              {pybooks.map(pb => <option key={pb.id} value={pb.id}>{pb.name}</option>)}
            </select>
            <button onClick={runOnSelected} disabled={!isAdmin || !runPybookId || runningSelected}
              className="inline-flex items-center gap-2 rounded-md bg-[#50fa7b]/15 px-3 py-1.5 text-xs text-[#b8ffc8] hover:bg-[#50fa7b]/25 disabled:opacity-40 disabled:cursor-not-allowed">
              <Play size={14} /> {runningSelected ? 'Queueing…' : 'Run on selected'}
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs text-[#6272a4] hover:text-[#f8f8f2]">Clear</button>
            <button onClick={deleteSelected} disabled={!isAdmin}
              className="inline-flex items-center gap-2 rounded-md bg-[#ff5555]/15 px-3 py-1.5 text-xs text-[#ffb3b3] hover:bg-[#ff5555]/25 disabled:opacity-40 disabled:cursor-not-allowed">
              <Trash2 size={14} /> Delete selected
            </button>
          </div>
        ) : (
          <span className="text-xs text-[#6272a4]">{runMessage || 'Use checkboxes to select entries without leaving the page.'}</span>
        )}
      </div>
      {runMessage && selectedCount > 0 && <p className="mb-4 text-xs text-[#8be9fd]">{runMessage}</p>}

      {/* Results */}
      {loading ? (
        <div className="text-gray-500 text-sm py-16 text-center">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <p className="text-sm">No entries found{hasFilter ? ' for the current filters' : ''}.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {entries.map(e => (
              <EntryCard
                key={e.id}
                entry={e}
                blueprintName={blueprintMap[e.blueprint_id]}
                selected={selectedIds.has(e.id)}
                onSelect={toggleSelected}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages !== null && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button onClick={() => setOffset(o => Math.max(0, o - pageSize))} disabled={offset === 0}
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors">
                ←
              </button>
              <span className="text-sm text-gray-400">
                Page {currentPage} of {totalPages}
              </span>
              <button onClick={() => setOffset(o => o + pageSize)} disabled={currentPage >= totalPages}
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors">
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
