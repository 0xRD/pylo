import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RunStatusBadge from '../components/RunStatusBadge'
import { runsApi } from '../api/pybooks'

const STATUSES = ['', 'pending', 'running', 'success', 'error', 'timeout']

export default function Runs() {
  const [runs, setRuns] = useState([])
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = (s = status) => runsApi.list({ status: s || undefined, limit: 100 })
    .then(setRuns).catch(console.error).finally(() => setLoading(false))

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  const handleStatusChange = (s) => { setStatus(s); load(s) }

  if (loading) return <div className="text-gray-500 text-sm">Loading…</div>

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Runs</h1>
          <select value={status} onChange={e => handleStatusChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none">
            {STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>

        {runs.length === 0 && <p className="text-sm text-gray-600 italic">No runs found.</p>}

        <div className="space-y-1">
          {runs.map(run => (
            <div key={run.id} onClick={() => setSelected(run)}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                selected?.id === run.id
                  ? 'border-indigo-500 bg-indigo-950'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              }`}>
              <RunStatusBadge status={run.status} />
              <span className="text-xs text-gray-400 font-mono w-16 shrink-0">{run.trigger_source}</span>
              <span className="text-sm text-gray-300 flex-1 truncate font-mono">{run.pybook_id.slice(0, 8)}</span>
              <span className="text-xs text-gray-500 shrink-0">
                {new Date(run.started_at).toLocaleString()}
              </span>
              {run.duration_ms != null && (
                <span className="text-xs text-gray-600 w-16 text-right shrink-0">{run.duration_ms}ms</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="w-96 shrink-0 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Run detail</h2>
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-300">×</button>
          </div>
          <div className="flex items-center gap-2">
            <RunStatusBadge status={selected.status} />
            <span className="text-xs text-gray-500">{selected.trigger_source}</span>
            {selected.exit_code != null && (
              <span className="text-xs text-gray-600">exit {selected.exit_code}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <p>PyBook: <span className="font-mono text-gray-300">{selected.pybook_id.slice(0, 12)}</span></p>
            <p>Started: {new Date(selected.started_at).toLocaleString()}</p>
            {selected.ended_at && <p>Ended: {new Date(selected.ended_at).toLocaleString()}</p>}
            {selected.duration_ms != null && <p>Duration: {selected.duration_ms}ms</p>}
          </div>
          {selected.stdout && (
            <div>
              <p className="text-xs text-gray-400 mb-1">stdout</p>
              <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-green-300 whitespace-pre-wrap overflow-auto max-h-64">
                {selected.stdout}
              </pre>
            </div>
          )}
          {selected.stderr && (
            <div>
              <p className="text-xs text-gray-400 mb-1">stderr</p>
              <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-red-300 whitespace-pre-wrap overflow-auto max-h-64">
                {selected.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
