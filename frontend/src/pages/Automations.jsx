import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const TRIGGER_LABELS = {
  manual: 'Manual',
  cron: 'Cron',
  webhook: 'Webhook',
  blueprint: 'Blueprint event',
}

const TRIGGER_COLORS = {
  manual: 'bg-gray-800 text-gray-400',
  cron: 'bg-blue-900 text-blue-300',
  webhook: 'bg-orange-900 text-orange-300',
  blueprint: 'bg-purple-900 text-purple-300',
}

function TriggerBadge({ type }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${TRIGGER_COLORS[type] || 'bg-gray-800 text-gray-400'}`}>
      {TRIGGER_LABELS[type] || type}
    </span>
  )
}

function TriggerDetail({ type, config, blueprints }) {
  let cfg = {}
  try { cfg = JSON.parse(config || '{}') } catch {}

  if (type === 'cron') {
    return <span className="text-xs font-mono text-gray-500">{cfg.cron || '—'}</span>
  }
  if (type === 'blueprint') {
    const bp = blueprints.find(b => b.id === cfg.blueprint_id)
    return (
      <span className="text-xs text-gray-500">
        {bp ? <Link to={`/blueprints/${bp.id}`} className="text-indigo-400 hover:underline">{bp.name}</Link> : '—'}
        {cfg.trigger_event && <span className="ml-1 text-gray-600">({cfg.trigger_event})</span>}
      </span>
    )
  }
  if (type === 'webhook') {
    return <span className="text-xs text-gray-500 font-mono">POST /hooks/…</span>
  }
  return null
}

export default function Automations() {
  const navigate = useNavigate()
  const [pybooks, setPybooks] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [blueprints, setBlueprints] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active') // 'active' | 'all'
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'pybook' | 'workflow'

  useEffect(() => {
    Promise.all([
      fetch('/api/pybooks', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/workflows', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/blueprints', { credentials: 'include' }).then(r => r.json()),
    ]).then(([pbs, wfs, bps]) => {
      setPybooks(Array.isArray(pbs) ? pbs : [])
      setWorkflows(Array.isArray(wfs) ? wfs : [])
      setBlueprints(Array.isArray(bps) ? bps : [])
    }).finally(() => setLoading(false))
  }, [])

  // Build unified list
  const items = [
    ...pybooks
      .filter(pb => typeFilter !== 'workflow')
      .filter(pb => filter === 'all' || (pb.is_active && pb.trigger_type !== 'manual'))
      .map(pb => ({ ...pb, _type: 'pybook', _name: pb.name, _id: pb.id })),
    ...workflows
      .filter(wf => typeFilter !== 'pybook')
      .filter(wf => filter === 'all' || (wf.is_active && wf.trigger_type !== 'manual'))
      .map(wf => ({ ...wf, _type: 'workflow', _name: wf.name, _id: wf.id })),
  ].sort((a, b) => a._name.localeCompare(b._name))

  const active = items.filter(i => i.is_active && i.trigger_type !== 'manual').length

  if (loading) return <div className="text-gray-500 text-sm p-8">Loading…</div>

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Automations</h1>
          <p className="text-xs text-gray-500 mt-1">All PyBooks and Workflows with active triggers</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Type filter */}
          <div className="flex rounded overflow-hidden border border-gray-700 text-xs">
            {['all', 'pybook', 'workflow'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 capitalize transition-colors ${typeFilter === t ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}>
                {t === 'pybook' ? 'PyBooks' : t === 'workflow' ? 'Workflows' : 'All'}
              </button>
            ))}
          </div>
          {/* Active filter */}
          <div className="flex rounded overflow-hidden border border-gray-700 text-xs">
            {['active', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 capitalize transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}>
                {f === 'active' ? `Active (${active})` : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <p className="text-sm">No automations found.</p>
          <p className="text-xs mt-2">
            Set a trigger type on a <Link to="/pybooks" className="text-indigo-400 hover:underline">PyBook</Link> or{' '}
            <Link to="/workflows" className="text-indigo-400 hover:underline">Workflow</Link> to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item._id} className={`flex items-center gap-4 px-4 py-3 rounded-lg border transition-colors ${
              item.is_active && item.trigger_type !== 'manual'
                ? 'border-gray-700 bg-gray-900'
                : 'border-gray-800 bg-gray-950 opacity-60'
            }`}>
              {/* Type badge */}
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                item._type === 'workflow' ? 'bg-purple-900 text-purple-300' : 'bg-blue-900 text-blue-300'
              }`}>
                {item._type === 'workflow' ? 'WF' : 'PB'}
              </span>

              {/* Name */}
              <button
                onClick={() => navigate(`/runs?${item._type === 'workflow' ? 'workflow' : 'pybook'}=${item._id}`)}
                className="text-sm text-gray-200 hover:text-indigo-300 flex-1 truncate font-medium transition-colors text-left bg-transparent border-0 cursor-pointer p-0">
                {item._name}
              </button>

              {/* Trigger type */}
              <TriggerBadge type={item.trigger_type} />

              {/* Trigger detail */}
              <div className="w-48 shrink-0">
                <TriggerDetail
                  type={item.trigger_type}
                  config={item.trigger_config || item.trigger_config}
                  blueprints={blueprints}
                />
              </div>

              {/* Active status */}
              <span className={`text-xs shrink-0 ${item.is_active ? 'text-green-400' : 'text-gray-600'}`}>
                {item.is_active ? '● active' : '○ inactive'}
              </span>
              <button
                onClick={() => navigate(`/runs?${item._type === 'workflow' ? 'workflow' : 'pybook'}=${item._id}`)}
                className="text-xs text-indigo-400 hover:text-indigo-200 shrink-0 bg-transparent border-0 cursor-pointer p-0"
                title="View runs">
                Runs →
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-900 border border-gray-800 rounded-lg">
        <p className="text-xs text-gray-500">
          <strong className="text-gray-400">PyBooks</strong> run code directly in Docker containers.{' '}
          <strong className="text-gray-400">Workflows</strong> chain multiple PyBooks in a DAG with conditional edges.
          Both support the same trigger types (cron, blueprint, webhook).
        </p>
      </div>
    </div>
  )
}
