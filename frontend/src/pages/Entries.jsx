import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'
import EntryCard from '../components/EntryCard'

const PAGE_SIZE_OPTIONS = [25, 48, 100, 200]
const DEFAULT_PAGE_SIZE = 48

export default function Entries() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [blueprints, setBlueprints] = useState([])
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(null)
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') || '')
  const [blueprintFilter, setBlueprintFilter] = useState(searchParams.get('blueprint') || '')
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    blueprintsApi.listBlueprints().then(setBlueprints).catch(() => {})
  }, [])

  const blueprintMap = Object.fromEntries(blueprints.map(b => [b.id, b.name]))

  const load = useCallback((q, bpId, off, ps) => {
    setLoading(true)
    blueprintsApi.listEntries({
      blueprintId: bpId || undefined,
      q: q || undefined,
      limit: ps,
      offset: off,
    })
      .then(data => {
        setEntries(Array.isArray(data) ? data : (data.items ?? data))
        setTotal(data.total ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(query, blueprintFilter, offset, pageSize)
  }, [query, blueprintFilter, offset, pageSize, load])

  const handleSearch = (e) => {
    e.preventDefault()
    setOffset(0)
    setQuery(draftQuery)
    const p = {}
    if (draftQuery) p.q = draftQuery
    if (blueprintFilter) p.blueprint = blueprintFilter
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
    setSearchParams(p)
  }

  const clearFilters = () => {
    setDraftQuery(''); setQuery(''); setBlueprintFilter(''); setOffset(0); setSearchParams({})
  }

  const totalPages = total !== null ? Math.ceil(total / pageSize) : null
  const currentPage = Math.floor(offset / pageSize) + 1

  const hasFilter = query || blueprintFilter

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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-600">Per page:</span>
            {PAGE_SIZE_OPTIONS.map(n => (
              <button key={n} onClick={() => { setPageSize(n); setOffset(0) }}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  n === pageSize
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 hover:bg-gray-700 text-gray-400'
                }`}>
                {n}
              </button>
            ))}
          </div>
          {hasFilter && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              × Clear filters
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
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}>
              {bp.name}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          value={draftQuery}
          onChange={e => setDraftQuery(e.target.value)}
          placeholder="Search entries…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <button type="submit"
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
          Search
        </button>
        {draftQuery && (
          <button type="button" onClick={() => { setDraftQuery(''); setQuery(''); setOffset(0) }}
            className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">×</button>
        )}
      </form>

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
              <EntryCard key={e.id} entry={e} blueprintName={blueprintMap[e.blueprint_id]} />
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
