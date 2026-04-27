import { useEffect, useState } from 'react'
import RunStatusBadge from '../components/RunStatusBadge'
import { runsApi } from '../api/pybooks'

const STATUSES = ['', 'queued', 'running', 'success', 'error', 'timeout']

export default function Runs() {
  const [runs, setRuns] = useState([])
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadRuns = (s = status) =>
    runsApi.list({ status: s || undefined, limit: 100 })
      .then(setRuns).catch(console.error).finally(() => setLoading(false))

  const loadStats = () =>
    runsApi.queueStats().then(setStats).catch(() => {})

  useEffect(() => {
    loadRuns(); loadStats()
    const t1 = setInterval(loadRuns, 5000)
    const t2 = setInterval(loadStats, 2000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  const handleStatusChange = (s) => { setStatus(s); loadRuns(s) }

  if (loading) return <div className="text-gray-500 text-sm">Loading…</div>

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 min-w-0">
        {/* Header with queue stats */}
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">Runs</h1>
            {stats && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-blue-300 font-medium">{stats.running}</span>
                  <span className="text-gray-500">running</span>
                  <span className="text-gray-700">/</span>
                  <span className="text-gray-400">{stats.max_concurrent} max</span>
                </div>
                {stats.queued > 0 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="text-yellow-300 font-medium">{stats.queued}</span>
                    <span className="text-gray-500">queued</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <select value={status} onChange={e => handleStatusChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none">
            {STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>

        {/* Concurrency bar */}
        {stats && (
          <div className="mb-4 p-3 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-400">Concurrency</span>
              <span className="text-xs text-gray-500">
                {stats.running} active · {stats.queued} waiting · {stats.max_concurrent} max
              </span>
            </div>
            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-gray-800">
              {Array.from({ length: stats.max_concurrent }).map((_, i) => (
                <div key={i} className={`flex-1 rounded-sm transition-colors ${
                  i < stats.running ? 'bg-blue-500' : 'bg-gray-700'
                }`} />
              ))}
            </div>
            {stats.queued > 0 && (
              <div className="mt-1.5 flex gap-0.5 h-1.5">
                {Array.from({ length: Math.min(stats.queued, 20) }).map((_, i) => (
                  <div key={i} className="w-2 h-full rounded-sm bg-yellow-600" />
                ))}
                {stats.queued > 20 && <span className="text-xs text-yellow-600 ml-1">+{stats.queued - 20}</span>}
              </div>
            )}
          </div>
        )}

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
              <span className="text-xs text-gray-500 shrink-0">{new Date(run.started_at).toLocaleString()}</span>
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
            {selected.exit_code != null && <span className="text-xs text-gray-600">exit {selected.exit_code}</span>}
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
              <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-green-300 whitespace-pre-wrap overflow-auto max-h-64">{selected.stdout}</pre>
            </div>
          )}
          {selected.stderr && (
            <div>
              <p className="text-xs text-gray-400 mb-1">stderr</p>
              <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-red-300 whitespace-pre-wrap overflow-auto max-h-64">{selected.stderr}</pre>
            </div>
          )}
          {(() => {
            let vars = {}
            try { vars = JSON.parse(selected.output_vars || '{}') } catch {}
            const entries = Object.entries(vars)
            if (entries.length === 0) return null
            return (
              <div>
                <p className="text-xs text-gray-400 mb-2">Variables</p>
                <div className="bg-gray-950 border border-gray-800 rounded divide-y divide-gray-800">
                  {entries.map(([k, v]) => (
                    <div key={k} className="flex gap-3 px-3 py-2 text-xs">
                      <span className="text-indigo-400 font-mono shrink-0">{k}</span>
                      <span className="text-gray-300 font-mono truncate">{JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
