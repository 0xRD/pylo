import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'
import EntryCard from '../components/EntryCard'

const PAGE_SIZE = 48

export default function Entries() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [blueprints, setBlueprints] = useState([])
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(null)
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [draftQuery, setDraftQuery] = useState(searchParams.get('q') || '')
  const [blueprintFilter, setBlueprintFilter] = useState(searchParams.get('blueprint') || '')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    blueprintsApi.listBlueprints().then(setBlueprints).catch(() => {})
  }, [])

  const blueprintMap = Object.fromEntries(blueprints.map(b => [b.id, b.name]))

  const load = useCallback((q, bpId, off) => {
    setLoading(true)
    blueprintsApi.listEntries({
      blueprintId: bpId || undefined,
      q: q || undefined,
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
    load(query, blueprintFilter, offset)
  }, [query, blueprintFilter, offset, load])

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
