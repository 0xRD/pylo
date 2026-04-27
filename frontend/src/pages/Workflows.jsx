import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const NODE_W = 204
const NODE_H = 90

const EDGE_COLORS = {
  always: '#4b5563',
  on_success: '#22c55e',
  on_failure: '#ef4444',
}

const STATUS_COLORS = {
  idle:    { dot: '#374151', text: '#6b7280', bg: 'transparent' },
  pending: { dot: '#6b7280', text: '#9ca3af', bg: 'rgba(107,114,128,0.08)' },
  running: { dot: '#3b82f6', text: '#93c5fd', bg: 'rgba(59,130,246,0.08)' },
  success: { dot: '#22c55e', text: '#86efac', bg: 'rgba(34,197,94,0.08)' },
  error:   { dot: '#ef4444', text: '#fca5a5', bg: 'rgba(239,68,68,0.08)' },
  timeout: { dot: '#f97316', text: '#fdba74', bg: 'rgba(249,115,22,0.08)' },
}

function MiniGraph({ nodes, edges }) {
  if (!nodes || nodes.length === 0) {
    return (
      <div style={{ width: '100%', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#1f2937', fontSize: 10 }}>no nodes</div>
      </div>
    )
  }
  const xs = nodes.map(n => n.x)
  const ys = nodes.map(n => n.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W
  const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H
  const W = 220, H = 56, pad = 8
  const scaleX = v => pad + ((v - minX) / (maxX - minX || 1)) * (W - pad * 2 - 28)
  const scaleY = v => pad + ((v - minY) / (maxY - minY || 1)) * (H - pad * 2 - 16)
  const cx = n => scaleX(n.x) + 14
  const cy = n => scaleY(n.y) + 8

  const PALETTE = ['#a78bfa', '#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#fb923c']

  return (
    <svg width={W} height={H} style={{ overflow: 'visible' }}>
      {edges.map((e, i) => {
        const fn = nodes.find(n => n.id === e.from)
        const tn = nodes.find(n => n.id === e.to)
        if (!fn || !tn) return null
        const x1 = cx(fn), y1 = cy(fn), x2 = cx(tn), y2 = cy(tn)
        const dx = Math.abs(x2 - x1) * 0.5
        return (
          <path key={i}
            d={`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`}
            stroke={EDGE_COLORS[e.condition] || '#374151'}
            strokeWidth={1.5} fill="none" opacity={0.7}
          />
        )
      })}
      {nodes.map((n, i) => {
        const color = PALETTE[i % PALETTE.length]
        return (
          <g key={n.id}>
            <circle cx={cx(n)} cy={cy(n)} r={7} fill={`${color}22`} stroke={color} strokeWidth={1.5} />
            <circle cx={cx(n)} cy={cy(n)} r={3} fill={color} />
          </g>
        )
      })}
    </svg>
  )
}

function WorkflowCard({ workflow, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes || '[]') : workflow.nodes
  const edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges || '[]') : workflow.edges

  const triggerIcons = {
    webhook: 'W',
    cron: '⏱',
    manual: '▶',
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#111118',
        border: `1px solid ${hovered ? '#4338ca' : '#1f2937'}`,
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered
          ? '0 0 0 1px rgba(99,102,241,0.15), 0 4px 24px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={() => onEdit(workflow.id)}
    >
      {/* Mini graph preview */}
      <div style={{ padding: '14px 16px 8px', background: '#0d0d14', borderBottom: '1px solid #1a1f2e' }}>
        <MiniGraph nodes={nodes} edges={edges} />
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#f1f5f9', fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workflow.name}
            </div>
            <div style={{ color: '#4b5563', fontSize: 11.5, marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {workflow.description || 'No description'}
            </div>
          </div>
          <div style={{
            flexShrink: 0, padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600,
            background: workflow.is_active ? 'rgba(99,102,241,0.12)' : 'rgba(55,65,81,0.3)',
            color: workflow.is_active ? '#818cf8' : '#4b5563',
            border: `1px solid ${workflow.is_active ? '#4338ca44' : '#1f2937'}`,
          }}>
            {workflow.is_active ? 'Active' : 'Inactive'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#4b5563' }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace' }}>{triggerIcons[workflow.trigger_type] || '▶'}</span>
            <span style={{ fontSize: 10.5, fontFamily: 'monospace' }}>{workflow.trigger_type}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#4b5563' }}>
            <span style={{ fontSize: 10 }}>⬡</span>
            <span style={{ fontSize: 10.5 }}>{nodes.length} nodes</span>
          </div>
          <div style={{ marginLeft: 'auto', color: '#4b5563', fontSize: 10.5, fontFamily: 'monospace' }}>
            {new Date(workflow.updated_at).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Hover actions */}
      <div style={{
        borderTop: '1px solid #1a1f2e',
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        gap: 6,
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.15s',
      }}>
        {[
          { label: 'Edit', color: '#818cf8', onClick: e => { e.stopPropagation(); onEdit(workflow.id) } },
          { label: 'Delete', color: '#ef4444', onClick: e => { e.stopPropagation(); onDelete(workflow.id) } },
        ].map(btn => (
          <button key={btn.label} onClick={btn.onClick} style={{
            padding: '4px 10px', borderRadius: 5, border: 'none',
            background: 'transparent', color: btn.color, fontSize: 11.5, fontWeight: 500,
            cursor: 'pointer', transition: 'background 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Workflows() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchWorkflows = async () => {
    try {
      const r = await fetch('/api/workflows', { credentials: 'include' })
      const data = await r.json()
      setWorkflows(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchWorkflows() }, [])

  const handleNew = async () => {
    const r = await fetch('/api/workflows', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Workflow', description: '', is_active: false, trigger_type: 'manual', nodes: '[]', edges: '[]' }),
    })
    const wf = await r.json()
    navigate(`/workflows/${wf.id}`)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this workflow?')) return
    await fetch(`/api/workflows/${id}`, { method: 'DELETE', credentials: 'include' })
    setWorkflows(wfs => wfs.filter(w => w.id !== id))
  }

  const active = workflows.filter(w => w.is_active).length

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#09090f', padding: '28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, fontFamily: 'inherit' }}>
            Workflows
          </h1>
          <div style={{ color: '#4b5563', fontSize: 12.5, marginTop: 4 }}>
            {active} active · {workflows.length} total
          </div>
        </div>
        <button onClick={handleNew} style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '8px 16px', borderRadius: 8,
          background: '#4f46e5', border: 'none', color: '#fff',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s',
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#4338ca' }}
        onMouseLeave={e => { e.currentTarget.style.background = '#4f46e5' }}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="6.5" y1="1" x2="6.5" y2="12" /><line x1="1" y1="6.5" x2="12" y2="6.5" />
          </svg>
          New Workflow
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', marginTop: 60 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {workflows.map(wf => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              onEdit={id => navigate(`/workflows/${id}`)}
              onDelete={handleDelete}
            />
          ))}

          {/* Empty-state / new placeholder */}
          <div
            onClick={handleNew}
            style={{
              border: '2px dashed #1f2937', borderRadius: 12,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: '32px', cursor: 'pointer', minHeight: 180,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#374151' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1f2937' }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, border: '1.5px dashed #374151', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" fill="none" stroke="#374151" strokeWidth="1.8">
                <line x1="9" y1="2" x2="9" y2="16" /><line x1="2" y1="9" x2="16" y2="9" />
              </svg>
            </div>
            <div style={{ color: '#374151', fontSize: 12, textAlign: 'center' }}>Create a new workflow</div>
          </div>
        </div>
      )}
    </div>
  )
}
