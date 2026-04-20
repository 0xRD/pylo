import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { objectsApi } from '../api/objects'

export default function ObjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [instance, setInstance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    objectsApi.getInstance(id)
      .then(setInstance)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!confirm('Delete this instance?')) return
    await objectsApi.deleteInstance(id)
    navigate(-1)
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading…</div>
  if (error) return <div className="text-red-400 text-sm">{error}</div>
  if (!instance) return null

  let data = {}
  let rawData = {}
  try { data = JSON.parse(instance.data) } catch {}
  try { rawData = JSON.parse(instance.raw_data) } catch {}

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="text-xs text-gray-500 hover:text-gray-300 mb-2 block">
            ← Back
          </button>
          <h1 className="text-xl font-semibold">
            Instance <span className="font-mono text-indigo-400">{instance.id.slice(0, 8)}</span>
          </h1>
          {instance.external_id && (
            <p className="text-sm text-gray-500 mt-1">External ID: <span className="font-mono">{instance.external_id}</span></p>
          )}
        </div>
        <button onClick={handleDelete}
          className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-red-900 rounded text-gray-400 hover:text-red-300 transition-colors">
          Delete
        </button>
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span>Created: {new Date(instance.created_at).toLocaleString()}</span>
        <span>Updated: {new Date(instance.updated_at).toLocaleString()}</span>
      </div>

      {/* Parsed fields */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Parsed Fields</h2>
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

      {/* Raw JSON */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Raw Data</h2>
        <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-auto max-h-96">
          {JSON.stringify(rawData, null, 2)}
        </pre>
      </section>
    </div>
  )
}
