import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'
import EntryCard from '../components/EntryCard'

const PAGE_SIZE = 48

function FilterHelp() {
  const [show, setShow] = useState(false)
  return (
    <span className="relative">
      <button type="button" onClick={() => setShow(s => !s)}
        className="text-gray-600 hover:text-gray-400 text-xs px-1">?</button>
      {show && (
        <div className="absolute right-0 top-5 z-20 w-64 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 shadow-xl">
          <p className="font-semibold text-gray-200 mb-2">Field filter syntax</p>
          <code className="block text-indigo-300 mb-1">field = "value"</code>
          <code className="block text-indigo-300 mb-1">field != "value"</code>
          <code className="block text-indigo-300 mb-1">field contains "text"</code>
          <code className="block text-indigo-300 mb-1">field starts_with "prefix"</code>
          <code className="block text-indigo-300 mb-3">field &gt; 5</code>
          <p className="text-gray-500">Chain with AND:</p>
          <code className="block text-indigo-300 mt-1 break-all">severity = "high" AND category contains "Execute"</code>
          <button onClick={() => setShow(false)} className="mt-2 text-gray-500 hover:text-gray-300">close</button>
        </div>
      )}
    </span>
  )
}

export default function Entries() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [blueprints, setBlueprints] = useState([])
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(null)
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') || '')
  const [fieldFilter, setFieldFilter] = useState(searchParams.get('filter') || '')
  const [draftFilter, setDraftFilter] = useState(searchParams.get('filter') || '')
  const [blueprintFilter, setBlueprintFilter] = useState(searchParams.get('blueprint') || '')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => {
    blueprintsApi.listBlueprints().then(setBlueprints).catch(() => {})
  }, [])

  const blueprintMap = Object.fromEntries(blueprints.map(b => [b.id, b.name]))

  const load = useCallback((q, filter, bpId, off) => {
    setLoading(true)
    setSelectedIds(new Set())
    blueprintsApi.listEntries({
      blueprintId: bpId || undefined,
      q: q || undefined,
      filter: filter || undefined,
      limit: PAGE_SIZE,
      offset: off,
    })
      .then(data => {
        setEntries(Array.isArray(data) ? data : data.items ?? data)
        if (data.total !== undefined) setTotal(data.total)
        else setTotal(null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(query, fieldFilter, blueprintFilter, offset)
  }, [query, fieldFilter, blueprintFilter, offset, load])

  const handleSearch = (e) => {
    e.preventDefault()
    setOffset(0)
    setQuery(draftQuery)
    setFieldFilter(draftFilter)
    const p = {}
    if (draftQuery) p.q = draftQuery
    if (draftFilter) p.filter = draftFilter
    if (blueprintFilter) p.blueprint = blueprintFilter
    setSearchParams(p)
  }

  const handleBlueprintFilter = (id) => {
    const next = id === blueprintFilter ? '' : id
    setBlueprintFilter(next)
    setOffset(0)
    const p = {}
    if (query) p.q = query
    if (fieldFilter) p.filter = fieldFilter
    if (next) p.blueprint = next
    setSearchParams(p)
  }

  const clearFilters = () => {
    setDraftQuery(''); setQuery('')
    setDraftFilter(''); setFieldFilter('')
    setBlueprintFilter(''); setOffset(0); setSearchParams({})
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(entries.map(e => e.id)))
  const clearSelection = () => setSelectedIds(new Set())

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} entr${selectedIds.size === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      await Promise.all([...selectedIds].map(id => blueprintsApi.deleteEntry(id)))
      setSelectedIds(new Set())
      load(query, fieldFilter, blueprintFilter, offset)
    } catch {
      alert('Some entries could not be deleted.')
    } finally {
      setBulkDeleting(false)
    }
  }

  const hasFilter = query || fieldFilter || blueprintFilter

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Entries</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total !== null
              ? `${total} entr${total === 1 ? 'y' : 'ies'}${hasFilter ? ' matching filters' : ''}`
              : 'All entries across blueprints'}
          </p>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            × Clear filters
          </button>
        )}
      </div>

      {/* Blueprint filter chips */}
      {blueprints.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {blueprints.map(bp => (
            <button key={bp.id} onClick={() => handleBlueprintFilter(bp.id)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                blueprintFilter === bp.id
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}>
              {bp.name}
            </button>
          ))}
        </div>
      )}

      {/* Search + filter form */}
      <form onSubmit={handleSearch} className="space-y-2 mb-6">
        <div className="flex gap-2">
          <input
            value={draftQuery}
            onChange={e => setDraftQuery(e.target.value)}
            placeholder="Full-text search…"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button type="submit"
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
            Search
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={draftFilter}
            onChange={e => setDraftFilter(e.target.value)}
            placeholder='Field filter: severity = "high" AND category contains "Execute"'
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
          />
          <FilterHelp />
          {(draftQuery || draftFilter) && (
            <button type="button" onClick={() => { setDraftQuery(''); setDraftFilter(''); setQuery(''); setFieldFilter(''); setOffset(0) }}
              className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">×</button>
          )}
        </div>
      </form>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-indigo-950/50 border border-indigo-800 rounded-lg">
          <span className="text-sm text-indigo-300 font-medium">{selectedIds.size} selected</span>
          <button onClick={selectAll} className="text-xs text-indigo-400 hover:text-indigo-200 transition-colors">
            Select all ({entries.length})
          </button>
          <button onClick={clearSelection} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Clear
          </button>
          <div className="ml-auto">
            <button onClick={handleBulkDelete} disabled={bulkDeleting}
              className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-xs font-medium transition-colors">
              {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size} entr${selectedIds.size === 1 ? 'y' : 'ies'}`}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="text-gray-500 text-sm py-16 text-center">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <p className="text-sm">No entries found{hasFilter ? ' for the current filters' : ''}.</p>
        </div>
      ) : (
        <>
          {selectedIds.size === 0 && (
            <div className="flex justify-end mb-2">
              <button onClick={selectAll}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                Select all
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {entries.map(e => (
              <EntryCard key={e.id} entry={e}
                blueprintName={blueprintMap[e.blueprint_id]}
                selected={selectedIds.has(e.id)}
                onSelect={toggleSelect}
              />
            ))}
          </div>

          {/* Pagination */}
          {entries.length === PAGE_SIZE && (
            <div className="flex justify-center gap-3 mt-8">
              {offset > 0 && (
                <button onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
                  ← Previous
                </button>
              )}
              <button onClick={() => setOffset(o => o + PAGE_SIZE)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
                Next →
              </button>
            </div>
          )}
          {offset > 0 && entries.length < PAGE_SIZE && (
            <div className="flex justify-center mt-8">
              <button onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
                ← Previous
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
