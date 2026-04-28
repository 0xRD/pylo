import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fmtDateTime, parseUTC } from '../utils/dates'
import RunStatusBadge from '../components/RunStatusBadge'
import { runsApi } from '../api/pybooks'

const workflowRunsApi = {
  list: ({ workflowId, status, limit = 100, offset = 0 } = {}) => {
    const p = new URLSearchParams()
    if (workflowId) p.set('workflow_id', workflowId)
    if (status) p.set('status', status)
    p.set('limit', limit)
    p.set('offset', offset)
    return fetch(`/api/workflows/runs?${p}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
  },
  getDetail: (workflowId, runId) =>
    fetch(`/api/workflows/${workflowId}/runs/${runId}`, { credentials: 'include' }).then(r => r.json()),
}

const STATUSES = ['', 'queued', 'running', 'success', 'error', 'timeout', 'pending']
const TYPES = ['all', 'pybook', 'workflow']

function formatJson(value) {
  try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2) }
  catch { return String(value || '') }
}

function VarsPanel({ vars }) {
  let entries = []
  try { entries = Object.entries(JSON.parse(vars || '{}')) } catch {}
  if (!entries.length) return null
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1.5">Variables</p>
      <div className="bg-gray-950 border border-gray-800 rounded divide-y divide-gray-800">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-3 py-1.5 text-xs">
            <span className="text-indigo-400 font-mono shrink-0">{k}</span>
            <span className="text-gray-300 font-mono truncate">{JSON.stringify(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PyBookRunDetail({ run }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#343746] bg-[#282a36] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <RunStatusBadge status={run.status} />
            <span className="text-xs text-gray-400">{run.trigger_source}</span>
            {run.exit_code != null && <span className="text-xs text-gray-500">exit {run.exit_code}</span>}
            {run.duration_ms != null && <span className="text-xs text-gray-500">{run.duration_ms}ms</span>}
          </div>
          <span className="max-w-full truncate font-mono text-[11px] text-gray-500">{run.id}</span>
        </div>
        <div className="mt-2 grid gap-1 text-xs text-gray-500 md:grid-cols-3">
          <p>PyBook: <span className="font-mono text-gray-300">{run.pybook_id?.slice(0, 12)}</span></p>
          <p>Started: {fmtDateTime(run.started_at)}</p>
          {run.ended_at && <p>Ended: {fmtDateTime(run.ended_at)}</p>}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="space-y-4 min-w-0">
          {run.stdout && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-green-300 mb-1">stdout</p>
              <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-green-300 whitespace-pre-wrap overflow-auto max-h-80">{run.stdout}</pre>
            </div>
          )}
          {run.stderr && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-300 mb-1">stderr</p>
              <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-red-300 whitespace-pre-wrap overflow-auto max-h-80">{run.stderr}</pre>
            </div>
          )}
          {!run.stdout && !run.stderr && <p className="text-xs italic text-gray-600">This run did not emit stdout or stderr.</p>}
        </div>
        <div className="space-y-4 min-w-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300 mb-1">Input payload</p>
            <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-cyan-200 whitespace-pre-wrap overflow-auto max-h-64">{formatJson(run.trigger_payload || '{}')}</pre>
          </div>
          <VarsPanel vars={run.output_vars} />
        </div>
      </div>
    </div>
  )
}

function WorkflowRunDetail({ run }) {
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    if (!run) return
    workflowRunsApi.getDetail(run.workflow_id, run.id)
      .then(setDetail).catch(() => {})
  }, [run?.id])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <RunStatusBadge status={run.status} />
        <span className="text-xs text-gray-500">{run.trigger_source}</span>
        {run.duration_ms != null && <span className="text-xs text-gray-600">{run.duration_ms}ms</span>}
      </div>
      <div className="text-xs text-gray-500 space-y-0.5">
        <p>Workflow: <span className="font-mono text-gray-300">{run.workflow_id?.slice(0, 12)}</span></p>
        <p>Started: {fmtDateTime(run.started_at)}</p>
        {run.ended_at && <p>Ended: {fmtDateTime(run.ended_at)}</p>}
      </div>
      {detail?.node_runs?.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Node runs</p>
          <div className="space-y-2">
            {detail.node_runs.map(nr => (
              <div key={nr.id} className="bg-gray-950 border border-gray-800 rounded p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RunStatusBadge status={nr.status} />
                    <span className="text-gray-500 font-mono">{nr.node_id?.slice(0, 8)}</span>
                  </div>
                  {nr.duration_ms != null && <span className="text-gray-600">{nr.duration_ms}ms</span>}
                </div>
                {nr.pybook_run_id && (
                  <p className="text-gray-600">PyBook run: <span className="font-mono text-gray-400">{nr.pybook_run_id.slice(0, 12)}</span></p>
                )}
                <VarsPanel vars={nr.output_vars} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Runs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initPybookId = searchParams.get('pybook') || ''
  const initWorkflowId = searchParams.get('workflow') || ''
  const [pyRuns, setPyRuns] = useState([])
  const [wfRuns, setWfRuns] = useState([])
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState('')
  const [runType, setRunType] = useState(initWorkflowId ? 'workflow' : initPybookId ? 'pybook' : 'all')
  const [scopePybookId, setScopePybookId] = useState(initPybookId)
  const [scopeWorkflowId, setScopeWorkflowId] = useState(initWorkflowId)
  const [names, setNames] = useState({})  // id -> name lookup
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadRuns = useCallback((s = status, t = runType, pbId = scopePybookId, wfId = scopeWorkflowId) => {
    const promises = []
    if (t !== 'workflow') promises.push(runsApi.list({ pybookId: pbId || undefined, status: s || undefined, limit: 100 }).then(setPyRuns).catch(() => setPyRuns([])))
    else promises.push(Promise.resolve())
    if (t !== 'pybook') promises.push(workflowRunsApi.list({ workflowId: wfId || undefined, status: s || undefined }).then(setWfRuns).catch(() => setWfRuns([])))
    else promises.push(Promise.resolve())
    Promise.all(promises).finally(() => setLoading(false))
  }, [status, runType, scopePybookId, scopeWorkflowId])

  const loadStats = () => runsApi.queueStats().then(setStats).catch(() => {})

  useEffect(() => {
    loadRuns(); loadStats()
    // Fetch names for display
    Promise.all([
      fetch('/api/pybooks', { credentials: 'include' }).then(r => r.json()).catch(() => []),
      fetch('/api/workflows', { credentials: 'include' }).then(r => r.json()).catch(() => []),
    ]).then(([pbs, wfs]) => {
      const n = {}
      ;(Array.isArray(pbs) ? pbs : []).forEach(pb => { n[pb.id] = pb.name })
      ;(Array.isArray(wfs) ? wfs : []).forEach(wf => { n[wf.id] = wf.name })
      setNames(n)
    })
    const t1 = setInterval(() => loadRuns(), 5000)
    const t2 = setInterval(loadStats, 2000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  const handleStatusChange = (s) => { setStatus(s); loadRuns(s, runType) }
  const handleTypeChange = (t) => {
    setRunType(t)
    // Clear scope filter when switching type manually
    const newPbId = t === 'workflow' ? '' : scopePybookId
    const newWfId = t === 'pybook' ? '' : scopeWorkflowId
    loadRuns(status, t, newPbId, newWfId)
  }
  const clearScope = () => {
    setScopePybookId(''); setScopeWorkflowId('')
    setSearchParams({})
    loadRuns(status, runType, '', '')
  }

  // Merge and sort runs by started_at
  const allRuns = [
    ...(runType !== 'workflow' ? pyRuns.map(r => ({ ...r, _type: 'pybook' })) : []),
    ...(runType !== 'pybook' ? wfRuns.map(r => ({ ...r, _type: 'workflow' })) : []),
  ].sort((a, b) => parseUTC(b.started_at) - parseUTC(a.started_at))

  if (loading) return <div className="text-gray-500 text-sm">Loading…</div>

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 min-w-0">
        {/* Header */}
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
          <div className="flex items-center gap-2">
            {/* Scope clear */}
            {(scopePybookId || scopeWorkflowId) && (
              <button onClick={clearScope}
                className="text-xs px-2 py-1 rounded border border-indigo-700 text-indigo-400 hover:text-indigo-200 hover:border-indigo-500 transition-colors bg-transparent cursor-pointer">
                ✕ {scopePybookId ? names[scopePybookId] || 'PyBook' : names[scopeWorkflowId] || 'Workflow'}
              </button>
            )}
            {/* Type filter */}
            <div className="flex rounded overflow-hidden border border-gray-700 text-xs">
              {TYPES.map(t => (
                <button key={t} onClick={() => handleTypeChange(t)}
                  className={`px-3 py-1.5 capitalize transition-colors ${runType === t ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}>
                  {t === 'pybook' ? 'PyBooks' : t === 'workflow' ? 'Workflows' : 'All'}
                </button>
              ))}
            </div>
            {/* Status filter */}
            <select value={status} onChange={e => handleStatusChange(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none">
              {STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
            </select>
          </div>
        </div>

        {/* Concurrency bar */}
        {stats && runType !== 'workflow' && (
          <div className="mb-4 p-3 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-400">PyBook concurrency</span>
              <span className="text-xs text-gray-500">
                {stats.running} active · {stats.queued} waiting · {stats.max_concurrent} max
              </span>
            </div>
            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-gray-800">
              {Array.from({ length: stats.max_concurrent }).map((_, i) => (
                <div key={i} className={`flex-1 rounded-sm transition-colors ${i < stats.running ? 'bg-blue-500' : 'bg-gray-700'}`} />
              ))}
            </div>
          </div>
        )}

        {allRuns.length === 0 && <p className="text-sm text-gray-600 italic">No runs found.</p>}

        <div className="space-y-1">
          {allRuns.map(run => (
            <div key={run.id} onClick={() => setSelected(run)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                selected?.id === run.id
                  ? 'border-indigo-500 bg-indigo-950'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              }`}>
              <RunStatusBadge status={run.status} />
              {/* Type badge */}
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                run._type === 'workflow'
                  ? 'bg-purple-900 text-purple-300'
                  : 'bg-blue-900 text-blue-300'
              }`}>
                {run._type === 'workflow' ? 'WF' : 'PB'}
              </span>
              <span className="text-xs text-gray-400 font-mono shrink-0">{run.trigger_source}</span>
              <span className="text-sm text-gray-300 flex-1 truncate">
                {run._type === 'workflow'
                  ? (names[run.workflow_id] || (run.workflow_id || '').slice(0, 8))
                  : (names[run.pybook_id] || (run.pybook_id || '').slice(0, 8))}
              </span>
              <span className="text-xs text-gray-500 shrink-0">{fmtDateTime(run.started_at)}</span>
              {run.duration_ms != null && (
                <span className="text-xs text-gray-600 w-16 text-right shrink-0">{run.duration_ms}ms</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-[420px] max-w-[42vw] shrink-0 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {selected._type === 'workflow' ? 'Workflow run' : 'PyBook run'}
            </h2>
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-300">×</button>
          </div>
          {selected._type === 'workflow'
            ? <WorkflowRunDetail run={selected} />
            : <PyBookRunDetail run={selected} />
          }
        </div>
      )}
    </div>
  )
}
