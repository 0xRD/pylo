import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { blueprintsApi } from '../api/blueprints'

export default function EntryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [entry, setEntry] = useState(null)
  const [blueprint, setBlueprint] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    blueprintsApi.getEntry(id)
      .then(e => {
        setEntry(e)
        return blueprintsApi.getBlueprint(e.blueprint_id)
      })
      .then(setBlueprint)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!confirm('Delete this entry?')) return
    await blueprintsApi.deleteEntry(id)
    navigate(`/blueprints/${entry.blueprint_id}`)
  }

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/entries')
  }

  if (loading) return <div className="text-gray-500 text-sm p-8">Loading…</div>
  if (error) return <div className="text-red-400 text-sm p-8">{error}</div>
  if (!entry) return null

  let data = {}
  let rawData = {}
  try { data = JSON.parse(entry.data) } catch {}
  try { rawData = JSON.parse(entry.raw_data) } catch {}

  return (
    <div className="max-w-3xl space-y-6 px-4 py-6">
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
          <h1 className="text-xl font-semibold">
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
        <span>Created: {new Date(entry.created_at).toLocaleString()}</span>
        <span>Updated: {new Date(entry.updated_at).toLocaleString()}</span>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Fields</h2>
        {Object.keys(data).length === 0 ? (
          <p className="text-sm text-gray-600 italic">No mapped fields.</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
            {Object.entries(data).map(([k, v]) => (
              <div key={k} className="flex gap-4 px-4 py-3 text-sm">
                <dt className="text-gray-400 w-40 shrink-0 font-mono text-xs pt-0.5">{k}</dt>
                <dd className="text-gray-100 break-all">{v === null ? <span className="text-gray-600">null</span> : String(v)}</dd>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Raw Data</h2>
        <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-auto max-h-96">
          {JSON.stringify(rawData, null, 2)}
        </pre>
      </section>
    </div>
  )
}
