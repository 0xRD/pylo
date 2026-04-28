import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ScheduleBuilder from '../components/ScheduleBuilder'

// ── Constants ─────────────────────────────────────────────────────────────────
const NODE_W = 204
const NODE_H = 90

const EDGE_COLORS = {
  always: '#4b5563',
  on_success: '#22c55e',
  on_failure: '#ef4444',
}

const STATUS_COLORS = {
  idle:    { dot: '#374151', text: '#6b7280' },
  pending: { dot: '#6b7280', text: '#9ca3af' },
  queued:  { dot: '#6b7280', text: '#9ca3af' },
  running: { dot: '#3b82f6', text: '#93c5fd' },
  success: { dot: '#22c55e', text: '#86efac' },
  error:   { dot: '#ef4444', text: '#fca5a5' },
  timeout: { dot: '#f97316', text: '#fdba74' },
}

const PYBOOK_COLORS = [
  '#a78bfa', '#60a5fa', '#34d399', '#f59e0b',
  '#f472b6', '#fb923c', '#818cf8', '#2dd4bf',
]

function pybookColor(pb, index) {
  if (!pb) return PYBOOK_COLORS[0]
  const seed = pb.id.charCodeAt(0) + pb.id.charCodeAt(1)
  return PYBOOK_COLORS[seed % PYBOOK_COLORS.length]
}

// ── SaveIndicator ─────────────────────────────────────────────────────────────
function SaveIndicator({ saved }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: saved ? '#4b5563' : '#818cf8', fontSize: 11, transition: 'color 0.3s' }}>
      {saved ? (
        <>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 7 5 10 10 4" /></svg>
          Saved
        </>
      ) : (
        <>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#818cf8', animation: 'savePulse 1s ease-in-out infinite' }} />
          Saving…
        </>
      )}
    </div>
  )
}

// ── RunStatusOverlay ──────────────────────────────────────────────────────────
function RunStatusOverlay({ active, done, total }) {
  if (!active) return null
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      background: '#111118', border: '1px solid #1f2937', borderRadius: 10,
      padding: '8px 16px', zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', animation: 'pulse 1.2s ease-in-out infinite' }} />
      <span style={{ color: '#93c5fd', fontSize: 12, fontWeight: 500 }}>Running</span>
      <div style={{ width: 100, height: 4, background: '#1f2937', borderRadius: 99 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#4f46e5', borderRadius: 99, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ color: '#4b5563', fontSize: 11, fontFamily: 'monospace' }}>{done}/{total}</span>
    </div>
  )
}

// ── PyBookPalette ─────────────────────────────────────────────────────────────
function PyBookPalette({ pybooks }) {
  const [query, setQuery] = useState('')
  const filtered = pybooks.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: '#0d0d14', borderRight: '1px solid #1f2937',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid #1a1f2e' }}>
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          PyBooks
        </div>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 8, top: 7, pointerEvents: 'none' }} width="13" height="13" fill="none" stroke="#4b5563" strokeWidth="1.8">
            <circle cx="5.5" cy="5.5" r="4.5" /><line x1="9.5" y1="9.5" x2="12" y2="12" />
          </svg>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%', background: '#111118', border: '1px solid #1f2937',
              borderRadius: 6, padding: '6px 8px 6px 26px',
              color: '#e2e8f0', fontSize: 11.5, outline: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
            onFocus={e => { e.target.style.borderColor = '#4338ca' }}
            onBlur={e => { e.target.style.borderColor = '#1f2937' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {filtered.map((pb, i) => {
          const color = pybookColor(pb, i)
          return (
            <div
              key={pb.id}
              draggable
              onDragStart={e => { e.dataTransfer.setData('pybookId', pb.id); e.dataTransfer.setData('pybookName', pb.name) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 9px', borderRadius: 7, marginBottom: 3,
                cursor: 'grab', border: '1px solid transparent',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#111118'; e.currentTarget.style.borderColor = '#1f2937' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: `${color}1a`, border: `1px solid ${color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#d1d5db', fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pb.name}
                </div>
                <div style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace', marginTop: 1 }}>
                  {pb.trigger_type}
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ color: '#374151', fontSize: 12, textAlign: 'center', marginTop: 24 }}>No PyBooks found</div>
        )}
      </div>

      <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1f2e' }}>
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center' }}>Drag to canvas to add</div>
      </div>
    </div>
  )
}

// ── EdgeLayer (SVG) ───────────────────────────────────────────────────────────
function EdgeLayer({ edges, nodes, selectedEdgeId, onSelectEdge, pendingEdge }) {
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <style>{`
          @keyframes flowDash { to { stroke-dashoffset: -24; } }
        `}</style>
        {Object.entries(EDGE_COLORS).map(([k, c]) => (
          <marker key={k} id={`arrow-${k}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={c} opacity="0.7" />
          </marker>
        ))}
        <marker id="arrow-selected" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#818cf8" opacity="0.9" />
        </marker>
        <marker id="arrow-pending" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#6366f1" opacity="0.6" />
        </marker>
      </defs>

      {/* Existing edges */}
      {edges.map(edge => {
        const fn = nodes.find(n => n.id === edge.from)
        const tn = nodes.find(n => n.id === edge.to)
        if (!fn || !tn) return null
        const sx = fn.x + NODE_W, sy = fn.y + NODE_H / 2
        const tx = tn.x,         ty = tn.y + NODE_H / 2
        const dx = Math.max(Math.abs(tx - sx) * 0.5, 60)
        const d = `M ${sx} ${sy} C ${sx+dx} ${sy} ${tx-dx} ${ty} ${tx} ${ty}`
        const sel = selectedEdgeId === edge.id
        const col = sel ? '#818cf8' : (EDGE_COLORS[edge.condition] || '#4b5563')
        const mx = (sx + tx) / 2, my = (sy + ty) / 2 - 10
        const labelMap = { always: 'always', on_success: 'success', on_failure: 'failure' }

        return (
          <g key={edge.id} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onSelectEdge(edge) }}>
            <path d={d} stroke="transparent" strokeWidth={16} fill="none" style={{ pointerEvents: 'stroke' }} />
            {sel && <path d={d} stroke="#818cf8" strokeWidth={6} fill="none" opacity={0.18} strokeLinecap="round" />}
            <path d={d} stroke={col} strokeWidth={sel ? 2 : 1.5} fill="none" strokeLinecap="round"
              markerEnd={`url(#${sel ? 'arrow-selected' : `arrow-${edge.condition}`})`}
              strokeDasharray={edge.animated ? '8 4' : undefined}
              style={edge.animated ? { animation: 'flowDash 0.7s linear infinite' } : undefined}
            />
            <g transform={`translate(${mx},${my})`}>
              <rect x={-24} y={-9} width={48} height={16} rx={8}
                fill={sel ? '#1e1b4b' : '#0f1117'} stroke={col} strokeWidth={1} opacity={0.95} />
              <text x={0} y={4} textAnchor="middle" fill={col} fontSize={9} fontFamily="monospace" fontWeight="500">
                {labelMap[edge.condition] || edge.condition}
              </text>
            </g>
          </g>
        )
      })}

      {/* Pending (drawing) edge */}
      {pendingEdge && (
        <path
          d={`M ${pendingEdge.x1} ${pendingEdge.y1} C ${pendingEdge.x1+60} ${pendingEdge.y1} ${pendingEdge.x2-60} ${pendingEdge.y2} ${pendingEdge.x2} ${pendingEdge.y2}`}
          stroke="#6366f1" strokeWidth={1.5} fill="none" strokeDasharray="6 3" opacity={0.7}
          markerEnd="url(#arrow-pending)"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}

// ── PyBookNode ────────────────────────────────────────────────────────────────
function PyBookNode({ node, pybook, selected, onSelect, onDragNode, onStartEdge, pybooks }) {
  const sc = STATUS_COLORS[node.status] || STATUS_COLORS.idle
  const pbColor = pybook ? pybookColor(pybook, 0) : '#818cf8'

  const handleMouseDown = e => {
    if (e.target.dataset.handle) return
    e.preventDefault()
    const startX = e.clientX - node.x
    const startY = e.clientY - node.y
    const move = me => onDragNode(node.id, me.clientX - startX, me.clientY - startY)
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      style={{ position: 'absolute', left: node.x, top: node.y, width: NODE_W, height: NODE_H, zIndex: selected ? 10 : 5 }}
      onMouseDown={handleMouseDown}
      onClick={e => { e.stopPropagation(); onSelect(node) }}
    >
      {/* Target handle (left) */}
      <div
        data-handle="target"
        style={{
          position: 'absolute', left: -6, top: NODE_H / 2 - 6,
          width: 12, height: 12, borderRadius: '50%',
          background: '#0f1117', border: `2px solid ${selected ? '#6366f1' : '#374151'}`,
          zIndex: 20, transition: 'border-color 0.15s', cursor: 'crosshair',
        }}
      />

      {/* Card */}
      <div style={{
        width: '100%', height: '100%',
        background: selected ? 'rgba(99,102,241,0.06)' : '#111118',
        border: `1px solid ${selected ? '#6366f1' : '#1f2937'}`,
        borderRadius: 10,
        boxShadow: selected
          ? '0 0 0 3px rgba(99,102,241,0.2), 0 4px 24px rgba(0,0,0,0.5)'
          : '0 2px 12px rgba(0,0,0,0.4)',
        cursor: 'grab', overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        userSelect: 'none',
      }}>
        <div style={{ height: 3, background: pbColor, opacity: 0.7 }} />
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: `${pbColor}22`, border: `1px solid ${pbColor}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={pbColor} strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div>
              <div style={{ color: '#f1f5f9', fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                {node.label}
              </div>
              <div style={{ color: '#4b5563', fontSize: 10.5, fontFamily: 'monospace', marginTop: 1 }}>
                {pybook?.name || node.pybookId}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: sc.dot,
                boxShadow: node.status === 'running' ? `0 0 8px ${sc.dot}` : undefined,
                animation: node.status === 'running' ? 'nodePulse 1.2s ease-in-out infinite' : undefined,
              }} />
              <span style={{ color: sc.text, fontSize: 10.5, textTransform: 'capitalize', fontFamily: 'monospace' }}>
                {node.status || 'idle'}
              </span>
            </div>
            {node.duration && (
              <span style={{ color: '#4b5563', fontSize: 10, fontFamily: 'monospace' }}>{node.duration}</span>
            )}
          </div>
        </div>
      </div>

      {/* Source handle (right) — drag to create edge */}
      <div
        data-handle="source"
        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartEdge(e, node) }}
        style={{
          position: 'absolute', right: -6, top: NODE_H / 2 - 6,
          width: 12, height: 12, borderRadius: '50%',
          background: '#0f1117', border: `2px solid ${selected ? '#6366f1' : '#374151'}`,
          zIndex: 20, transition: 'border-color 0.15s, border-color 0.15s', cursor: 'crosshair',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#1e1b4b' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = selected ? '#6366f1' : '#374151'; e.currentTarget.style.background = '#0f1117' }}
      />
    </div>
  )
}

// ── WorkflowCanvas ────────────────────────────────────────────────────────────
function WorkflowCanvas({ workflow, pybooks, selectedItem, onSelectNode, onSelectEdge, onSelectCanvas, onAddNode, onDragNode, onAddEdge }) {
  const dropRef = useRef(null)
  const [pendingEdge, setPendingEdge] = useState(null)

  const handleDrop = e => {
    e.preventDefault()
    const pybookId = e.dataTransfer.getData('pybookId')
    const pybookName = e.dataTransfer.getData('pybookName')
    if (!pybookId || !dropRef.current) return
    const rect = dropRef.current.getBoundingClientRect()
    const x = Math.max(0, e.clientX - rect.left - NODE_W / 2)
    const y = Math.max(0, e.clientY - rect.top - NODE_H / 2)
    onAddNode(pybookId, pybookName, x, y)
  }

  const handleStartEdge = (e, sourceNode) => {
    if (!dropRef.current) return
    const rect = dropRef.current.getBoundingClientRect()
    const x1 = sourceNode.x + NODE_W
    const y1 = sourceNode.y + NODE_H / 2
    setPendingEdge({ fromNodeId: sourceNode.id, x1, y1, x2: x1, y2: y1 })

    const onMove = me => {
      setPendingEdge(pe => pe ? { ...pe, x2: me.clientX - rect.left, y2: me.clientY - rect.top } : null)
    }
    const onUp = me => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const x = me.clientX - rect.left
      const y = me.clientY - rect.top
      const target = workflow.nodes.find(n =>
        n.id !== sourceNode.id &&
        x >= n.x - 10 && x <= n.x + NODE_W + 10 &&
        y >= n.y - 10 && y <= n.y + NODE_H + 10
      )
      if (target) onAddEdge(sourceNode.id, target.id)
      setPendingEdge(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={dropRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#09090f' }}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onClick={() => onSelectCanvas()}
    >
      {/* Dot grid */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <defs>
          <pattern id="dotgrid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="#1a1f2e" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotgrid)" />
      </svg>

      {/* Edges */}
      <EdgeLayer
        edges={workflow.edges}
        nodes={workflow.nodes}
        selectedEdgeId={selectedItem?.type === 'edge' ? selectedItem.data.id : null}
        onSelectEdge={e => onSelectEdge(e)}
        pendingEdge={pendingEdge}
      />

      {/* Nodes */}
      {workflow.nodes.map(node => {
        const pb = pybooks.find(p => p.id === node.pybookId)
        return (
          <PyBookNode
            key={node.id}
            node={node}
            pybook={pb}
            pybooks={pybooks}
            selected={selectedItem?.type === 'node' && selectedItem.data.id === node.id}
            onSelect={n => onSelectNode(n)}
            onDragNode={onDragNode}
            onStartEdge={handleStartEdge}
          />
        )
      })}

      {/* Empty state */}
      {workflow.nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, pointerEvents: 'none',
        }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, border: '2px dashed #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" fill="none" stroke="#374151" strokeWidth="1.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div style={{ textAlign: 'center', color: '#374151', fontSize: 13, lineHeight: 1.6 }}>
            Drag a PyBook from the palette<br />to start building your workflow
          </div>
        </div>
      )}
    </div>
  )
}

// ── WfTriggerConditionBuilder ─────────────────────────────────────────────────────
const WF_TRIGGER_OPS = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'regex', label: 'regex' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
]

function WfTriggerConditionBuilder({ value, onChange }) {
  const conditions = (() => { try { return JSON.parse(value || '[]') } catch { return [] } })()
  const update = next => onChange(JSON.stringify(next))
  const add = () => update([...conditions, { field: '', operator: 'eq', value: '' }])
  const remove = i => update(conditions.filter((_, idx) => idx !== i))
  const setC = (i, k, v) => update(conditions.map((c, idx) => idx === i ? { ...c, [k]: v } : c))

  const inputStyle = {
    background: '#0f1117', border: '1px solid #1f2937', borderRadius: 4,
    padding: '4px 6px', color: '#e2e8f0', fontSize: 11, outline: 'none',
    fontFamily: 'monospace',
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #1f2937', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Conditions
        </span>
        <button type='button' onClick={add} style={{
          fontSize: 10, color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>+ Add</button>
      </div>
      {conditions.length === 0 && (
        <p style={{ color: '#4b5563', fontSize: 10, fontStyle: 'italic', margin: 0 }}>
          No conditions — fires for every matching entry.
        </p>
      )}
      {conditions.map((cond, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input value={cond.field} onChange={e => setC(i, 'field', e.target.value)} placeholder='field'
            style={{ ...inputStyle, width: 70 }} />
          <select value={cond.operator} onChange={e => setC(i, 'operator', e.target.value)}
            style={{ ...inputStyle, padding: '4px 4px' }}>
            {WF_TRIGGER_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
          </select>
          <input value={cond.value} onChange={e => setC(i, 'value', e.target.value)} placeholder='value'
            style={{ ...inputStyle, flex: 1 }} />
          <button type='button' onClick={() => remove(i)} style={{
            color: '#4b5563', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
          }}>×</button>
        </div>
      ))}
    </div>
  )
}

// ── PropertiesPanel ───────────────────────────────────────────────────────────
function ConditionSelect({ value, onChange }) {
  const opts = [
    { value: 'always',     label: 'Always',    color: '#6b7280' },
    { value: 'on_success', label: 'Success',   color: '#22c55e' },
    { value: 'on_failure', label: 'Failure',   color: '#ef4444' },
  ]
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {opts.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11, fontWeight: 500,
          cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
          border: `1px solid ${value === o.value ? o.color : '#1f2937'}`,
          background: value === o.value ? `${o.color}18` : '#0f1117',
          color: value === o.value ? o.color : '#6b7280',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function FieldInput({ value, onChange, placeholder, mono }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{
        width: '100%', background: '#0f1117', border: '1px solid #1f2937',
        borderRadius: 6, padding: '6px 10px', color: '#e2e8f0',
        fontSize: mono ? 11 : 12, fontFamily: mono ? 'monospace' : 'inherit',
        outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
      }}
      onFocus={e => { e.target.style.borderColor = '#6366f1' }}
      onBlur={e => { e.target.style.borderColor = '#1f2937' }}
    />
  )
}

function PanelLabel({ children }) {
  return <div style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</div>
}

function Divider() {
  return <div style={{ height: 1, background: '#1f2937', margin: '12px 0' }} />
}

function PropertiesPanel({ selectedItem, workflow, blueprints, onUpdateEdge, onUpdateNode, onUpdateWorkflow, onDeleteNode, onDeleteEdge }) {
  const panelStyle = {
    width: 268, flexShrink: 0, background: '#0d0d14', borderLeft: '1px solid #1f2937',
    overflowY: 'auto', padding: '16px 14px',
  }
  const titleStyle = { color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }

  if (!selectedItem) {
    return (
      <div style={panelStyle}>
        <div style={titleStyle}>Workflow Properties</div>
        <PanelLabel>Name</PanelLabel>
        <FieldInput value={workflow.name} onChange={v => onUpdateWorkflow({ name: v })} placeholder="Workflow name" />
        <div style={{ marginTop: 10 }} />
        <PanelLabel>Description</PanelLabel>
        <textarea
          value={workflow.description || ''}
          onChange={e => onUpdateWorkflow({ description: e.target.value })}
          rows={3}
          style={{
            width: '100%', background: '#0f1117', border: '1px solid #1f2937',
            borderRadius: 6, padding: '6px 10px', color: '#e2e8f0',
            fontSize: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            fontFamily: 'inherit', lineHeight: 1.5,
          }}
          onFocus={e => { e.target.style.borderColor = '#6366f1' }}
          onBlur={e => { e.target.style.borderColor = '#1f2937' }}
        />
        <Divider />
        <PanelLabel>Trigger</PanelLabel>
        {(() => {
          const tc = (() => { try { return JSON.parse(workflow.trigger_config || '{}') } catch { return {} } })()
          const setTc = (k, v) => onUpdateWorkflow({ trigger_config: JSON.stringify({ ...tc, [k]: v }) })
          const TRIGGER_LABELS = { manual: 'On demand', cron: 'Cron schedule', webhook: 'Webhook', blueprint: 'Blueprint event' }
          return (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {['manual', 'cron', 'webhook', 'blueprint'].map(t => (
                  <label key={t} style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    padding: '6px 8px', borderRadius: 6,
                    border: `1px solid ${workflow.trigger_type === t ? '#6366f1' : '#1f2937'}`,
                    background: workflow.trigger_type === t ? 'rgba(99,102,241,0.06)' : 'transparent',
                    transition: 'all 0.12s',
                  }}>
                    <input type="radio" checked={workflow.trigger_type === t}
                      onChange={() => onUpdateWorkflow({ trigger_type: t, trigger_config: '{}' })}
                      style={{ accentColor: '#6366f1' }} />
                    <div style={{ color: workflow.trigger_type === t ? '#818cf8' : '#9ca3af', fontSize: 12, fontWeight: 500 }}>
                      {TRIGGER_LABELS[t]}
                    </div>
                  </label>
                ))}
              </div>

              {workflow.trigger_type === 'cron' && (
                <div style={{ marginTop: 10 }}>
                  <ScheduleBuilder
                    value={tc.cron || '0 8 * * *'}
                    onChange={cron => setTc('cron', cron)}
                  />
                </div>
              )}

              {workflow.trigger_type === 'blueprint' && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>Blueprint</div>
                    <select value={tc.blueprint_id || ''} onChange={e => setTc('blueprint_id', e.target.value)}
                      style={{ width: '100%', background: '#0f1117', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px', color: '#e2e8f0', fontSize: 12, outline: 'none' }}>
                      <option value="">— select blueprint —</option>
                      {(blueprints || []).map(bp => <option key={bp.id} value={bp.id}>{bp.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>Event</div>
                    <select value={tc.trigger_event || 'on_create'} onChange={e => setTc('trigger_event', e.target.value)}
                      style={{ width: '100%', background: '#0f1117', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px', color: '#e2e8f0', fontSize: 12, outline: 'none' }}>
                      <option value="on_create">On new entry</option>
                      <option value="on_create_or_update">On new or updated entry</option>
                    </select>
                  </div>
                  {tc.blueprint_id && (
                    <WfTriggerConditionBuilder
                      value={JSON.stringify(tc.trigger_conditions || [])}
                      onChange={v => { try { setTc('trigger_conditions', JSON.parse(v)) } catch {} }}
                    />
                  )}
                </div>
              )}
            </>
          )
        })()}
        <Divider />
        <PanelLabel>Status</PanelLabel>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>Active</span>
          <div onClick={() => onUpdateWorkflow({ is_active: !workflow.is_active })}
            style={{ width: 36, height: 20, borderRadius: 10, position: 'relative', cursor: 'pointer', background: workflow.is_active ? '#4f46e5' : '#1f2937', transition: 'background 0.2s' }}>
            <div style={{ position: 'absolute', top: 3, left: workflow.is_active ? 18 : 3, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
          </div>
        </label>
      </div>
    )
  }

  if (selectedItem.type === 'node') {
    const node = selectedItem.data
    return (
      <div style={panelStyle}>
        <div style={titleStyle}>Node Properties</div>
        <PanelLabel>Label in workflow</PanelLabel>
        <FieldInput value={node.label} onChange={v => onUpdateNode(node.id, { label: v })} />
        <Divider />
        <button onClick={() => onDeleteNode(node.id)} style={{
          width: '100%', padding: '7px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          color: '#f87171', cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.14)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}>
          Remove node
        </button>
      </div>
    )
  }

  if (selectedItem.type === 'edge') {
    const edge = selectedItem.data
    return (
      <div style={panelStyle}>
        <div style={titleStyle}>Connection</div>
        <PanelLabel>Condition</PanelLabel>
        <ConditionSelect value={edge.condition} onChange={v => onUpdateEdge(edge.id, { condition: v })} />
        <Divider />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <PanelLabel>Payload Mapping</PanelLabel>
          <button onClick={() => onUpdateEdge(edge.id, { mappings: [...(edge.mappings || []), { key: '', source: '' }] })}
            style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 11, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit' }}>
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="1" x2="5" y2="9" /><line x1="1" y1="5" x2="9" y2="5" /></svg>
            Add
          </button>
        </div>
        {(!edge.mappings || edge.mappings.length === 0) && (
          <div style={{ color: '#374151', fontSize: 11, padding: '8px', textAlign: 'center', border: '1px dashed #1f2937', borderRadius: 6 }}>No mappings</div>
        )}
        {(edge.mappings || []).map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <FieldInput value={m.key} onChange={v => { const ms = [...edge.mappings]; ms[i] = { ...ms[i], key: v }; onUpdateEdge(edge.id, { mappings: ms }) }} placeholder="target key" />
            </div>
            <svg width="12" height="12" fill="none" stroke="#374151" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M3 6h6M6 3l3 3-3 3" /></svg>
            <div style={{ flex: 1 }}>
              <FieldInput value={m.source} onChange={v => { const ms = [...edge.mappings]; ms[i] = { ...ms[i], source: v }; onUpdateEdge(edge.id, { mappings: ms }) }} placeholder="$.vars.x" mono />
            </div>
            <button onClick={() => { const ms = edge.mappings.filter((_, j) => j !== i); onUpdateEdge(edge.id, { mappings: ms }) }}
              style={{ background: 'none', border: 'none', color: '#374151', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>✕</button>
          </div>
        ))}
        <Divider />
        <button onClick={() => onDeleteEdge(edge.id)} style={{
          width: '100%', padding: '7px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          color: '#f87171', cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.14)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}>
          Remove connection
        </button>
      </div>
    )
  }

  return null
}

// ── RunHistory ────────────────────────────────────────────────────────────────
function RunHistory({ workflowId }) {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/workflows/${workflowId}/runs`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setRuns(Array.isArray(data) ? data : []); setLoading(false) })
  }, [workflowId])

  const sc = s => STATUS_COLORS[s] || STATUS_COLORS.idle

  if (loading) return <div style={{ padding: 24, color: '#4b5563', fontSize: 12 }}>Loading…</div>
  if (runs.length === 0) return (
    <div style={{ padding: 24, textAlign: 'center', color: '#374151', fontSize: 12 }}>
      No runs yet — trigger a run to see history here.
    </div>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1f2937' }}>
            {['Run ID', 'Status', 'Trigger', 'Started', 'Duration'].map(h => (
              <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map(r => {
            const c = sc(r.status)
            const fmt = new Date(r.started_at).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #111118', transition: 'background 0.1s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#111118' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <td style={{ padding: '9px 14px', color: '#4b5563', fontFamily: 'monospace' }}>{r.id.slice(0, 8)}…</td>
                <td style={{ padding: '9px 14px' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
                    borderRadius: 99, fontSize: 10.5, fontWeight: 500,
                    background: `${c.dot}18`, color: c.text, border: `1px solid ${c.dot}33`,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.dot, display: 'inline-block' }} />
                    {r.status}
                  </span>
                </td>
                <td style={{ padding: '9px 14px', color: '#6b7280', fontFamily: 'monospace' }}>{r.trigger_source}</td>
                <td style={{ padding: '9px 14px', color: '#6b7280' }}>{fmt}</td>
                <td style={{ padding: '9px 14px', color: '#6b7280', fontFamily: 'monospace' }}>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── WorkflowEditor (main) ─────────────────────────────────────────────────────
export default function WorkflowEditor() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [workflow, setWorkflow] = useState(null)
  const [pybooks, setPybooks] = useState([])
  const [blueprints, setBlueprints] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)
  const [activeTab, setActiveTab] = useState('canvas')
  const [saved, setSaved] = useState(true)
  const [runState, setRunState] = useState({ active: false, done: 0, total: 0, runId: null })
  const nodeCounter = useRef(100)
  const edgeCounter = useRef(100)
  const saveTimer = useRef(null)
  const initialLoad = useRef(true)

  // Load workflow + pybooks
  useEffect(() => {
    Promise.all([
      fetch(`/api/workflows/${id}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/api/pybooks', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/blueprints', { credentials: 'include' }).then(r => r.json()),
    ]).then(([wf, pbs, bpData]) => {
      setWorkflow({
        ...wf,
        nodes: JSON.parse(wf.nodes || '[]'),
        edges: JSON.parse(wf.edges || '[]'),
      })
      setPybooks(Array.isArray(pbs) ? pbs : [])
      setBlueprints(Array.isArray(bpData) ? bpData : [])
      setLoading(false)
    }).catch(err => {
      console.error('Failed to load workflow', err)
      setLoading(false)
    })
  }, [id])

  // Auto-save with 900ms debounce
  useEffect(() => {
    if (!workflow || loading) return
    if (initialLoad.current) { initialLoad.current = false; return }
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/workflows/${id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: workflow.name,
            description: workflow.description,
            is_active: workflow.is_active,
            trigger_type: workflow.trigger_type,
            nodes: JSON.stringify(workflow.nodes),
            edges: JSON.stringify(workflow.edges),
          }),
        })
        setSaved(true)
      } catch (e) { console.error('Save failed', e) }
    }, 900)
    return () => clearTimeout(saveTimer.current)
  }, [workflow])

  // Poll run status
  useEffect(() => {
    if (!runState.active || !runState.runId) return
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/workflows/${id}/runs/${runState.runId}`, { credentials: 'include' })
        const data = await r.json()
        const nodeRuns = data.node_runs || []
        const doneCount = nodeRuns.filter(nr => ['success', 'error', 'timeout'].includes(nr.status)).length

        setWorkflow(wf => ({
          ...wf,
          nodes: wf.nodes.map(n => {
            const nr = nodeRuns.find(nr => nr.node_id === n.id)
            if (!nr) return n
            return {
              ...n,
              status: nr.status,
              duration: nr.duration_ms ? `${(nr.duration_ms / 1000).toFixed(1)}s` : null,
            }
          }),
        }))
        setRunState(rs => ({ ...rs, done: doneCount, total: nodeRuns.length || rs.total }))

        if (['success', 'error', 'timeout'].includes(data.status)) {
          setRunState({ active: false, done: 0, total: 0, runId: null })
          clearInterval(interval)
        }
      } catch (e) { console.error('Poll failed', e) }
    }, 1000)
    return () => clearInterval(interval)
  }, [runState.active, runState.runId, id])

  const updateWorkflow = useCallback(patch => setWorkflow(wf => ({ ...wf, ...patch })), [])

  const updateNode = useCallback((nodeId, patch) => {
    setWorkflow(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === nodeId ? { ...n, ...patch } : n) }))
    setSelectedItem(s => s?.type === 'node' && s.data.id === nodeId ? { type: 'node', data: { ...s.data, ...patch } } : s)
  }, [])

  const updateEdge = useCallback((edgeId, patch) => {
    setWorkflow(wf => ({ ...wf, edges: wf.edges.map(e => e.id === edgeId ? { ...e, ...patch } : e) }))
    setSelectedItem(s => s?.type === 'edge' && s.data.id === edgeId ? { type: 'edge', data: { ...s.data, ...patch } } : s)
  }, [])

  const deleteNode = useCallback(nodeId => {
    setWorkflow(wf => ({
      ...wf,
      nodes: wf.nodes.filter(n => n.id !== nodeId),
      edges: wf.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
    }))
    setSelectedItem(null)
  }, [])

  const deleteEdge = useCallback(edgeId => {
    setWorkflow(wf => ({ ...wf, edges: wf.edges.filter(e => e.id !== edgeId) }))
    setSelectedItem(null)
  }, [])

  const addNode = useCallback((pybookId, pybookName, x, y) => {
    const id = `n${nodeCounter.current++}`
    setWorkflow(wf => ({
      ...wf,
      nodes: [...wf.nodes, { id, pybookId, label: pybookName, x: Math.max(0, x), y: Math.max(0, y), status: 'idle', duration: null }],
    }))
  }, [])

  const addEdge = useCallback((fromId, toId) => {
    setWorkflow(wf => {
      const exists = wf.edges.some(e => e.from === fromId && e.to === toId)
      if (exists) return wf
      const eid = `e${edgeCounter.current++}`
      return { ...wf, edges: [...wf.edges, { id: eid, from: fromId, to: toId, condition: 'always', mappings: [], animated: false }] }
    })
  }, [])

  const dragNode = useCallback((nodeId, x, y) => {
    setWorkflow(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === nodeId ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n) }))
  }, [])

  const handleRun = async () => {
    if (runState.active || !workflow.nodes.length) return
    setWorkflow(wf => ({
      ...wf,
      nodes: wf.nodes.map(n => ({ ...n, status: 'idle', duration: null })),
      edges: wf.edges.map(e => ({ ...e, animated: false })),
    }))
    try {
      const r = await fetch(`/api/workflows/${id}/run`, { method: 'POST', credentials: 'include' })
      const data = await r.json()
      setRunState({ active: true, done: 0, total: workflow.nodes.length, runId: data.id })
    } catch (e) { console.error('Run failed', e) }
  }

  const syncedSelected = useMemo(() => {
    if (!selectedItem || !workflow) return null
    if (selectedItem.type === 'node') {
      const n = workflow.nodes.find(n => n.id === selectedItem.data.id)
      return n ? { type: 'node', data: n } : null
    }
    if (selectedItem.type === 'edge') {
      const e = workflow.edges.find(e => e.id === selectedItem.data.id)
      return e ? { type: 'edge', data: e } : null
    }
    return null
  }, [selectedItem, workflow])

  if (loading || !workflow) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090f' }}>
        <div style={{ color: '#4b5563', fontSize: 13 }}>Loading…</div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes nodePulse { 0%,100%{opacity:1;box-shadow:0 0 6px currentColor}50%{opacity:0.5;box-shadow:0 0 12px currentColor} }
        @keyframes savePulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#09090f' }}>

        {/* Toolbar */}
        <div style={{
          height: 52, flexShrink: 0, background: '#0d0d14', borderBottom: '1px solid #1f2937',
          display: 'flex', alignItems: 'center', paddingLeft: 14, paddingRight: 14, gap: 12,
        }}>
          <button onClick={() => navigate('/workflows')} style={{
            display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
            color: '#4b5563', cursor: 'pointer', padding: '5px 8px', borderRadius: 6, fontSize: 12,
            transition: 'color 0.15s', flexShrink: 0, fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#4b5563' }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="10 4 4 8 10 12" /></svg>
            Workflows
          </button>

          <div style={{ width: 1, height: 20, background: '#1f2937', flexShrink: 0 }} />

          <input
            value={workflow.name}
            onChange={e => updateWorkflow({ name: e.target.value })}
            style={{
              background: 'none', border: 'none', color: '#f1f5f9', fontSize: 14, fontWeight: 600,
              outline: 'none', minWidth: 0, flex: 1, letterSpacing: '-0.02em', fontFamily: 'inherit',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <span style={{ color: workflow.is_active ? '#818cf8' : '#4b5563', fontSize: 11.5, fontWeight: 500 }}>
              {workflow.is_active ? 'Active' : 'Inactive'}
            </span>
            <div onClick={() => updateWorkflow({ is_active: !workflow.is_active })} style={{
              width: 34, height: 18, borderRadius: 9, position: 'relative', cursor: 'pointer',
              background: workflow.is_active ? '#4f46e5' : '#1f2937', transition: 'background 0.2s',
            }}>
              <div style={{
                position: 'absolute', top: 2, left: workflow.is_active ? 16 : 2,
                width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
              }} />
            </div>
          </div>

          <div style={{ width: 1, height: 20, background: '#1f2937', flexShrink: 0 }} />
          <SaveIndicator saved={saved} />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={handleRun} disabled={runState.active || workflow.nodes.length === 0} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              background: runState.active ? '#1f2937' : '#4f46e5', border: 'none',
              borderRadius: 7, color: runState.active ? '#4b5563' : '#fff',
              fontSize: 12.5, fontWeight: 600, cursor: runState.active ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (!runState.active) e.currentTarget.style.background = '#4338ca' }}
            onMouseLeave={e => { if (!runState.active) e.currentTarget.style.background = '#4f46e5' }}>
              <svg width="11" height="11" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3 2l11 6-11 6V2z" />
              </svg>
              {runState.active ? 'Running…' : 'Run Now'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <PyBookPalette pybooks={pybooks} />

          {/* Center: tabs + canvas/history */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ height: 38, background: '#0d0d14', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', paddingLeft: 12, gap: 2, flexShrink: 0 }}>
              {[['canvas', 'Canvas'], ['runs', 'Run History']].map(([tabId, label]) => (
                <button key={tabId} onClick={() => setActiveTab(tabId)} style={{
                  padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  background: activeTab === tabId ? '#111118' : 'none',
                  color: activeTab === tabId ? '#e2e8f0' : '#4b5563',
                  transition: 'all 0.15s', fontFamily: 'inherit',
                }}>
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'canvas' ? (
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <RunStatusOverlay active={runState.active} done={runState.done} total={runState.total} />
                <WorkflowCanvas
                  workflow={workflow}
                  pybooks={pybooks}
                  selectedItem={syncedSelected}
                  onSelectNode={node => setSelectedItem({ type: 'node', data: node })}
                  onSelectEdge={edge => setSelectedItem({ type: 'edge', data: edge })}
                  onSelectCanvas={() => setSelectedItem(null)}
                  onAddNode={addNode}
                  onDragNode={dragNode}
                  onAddEdge={addEdge}
                />
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', background: '#09090f' }}>
                <RunHistory workflowId={id} />
              </div>
            )}
          </div>

          <PropertiesPanel
            selectedItem={syncedSelected}
            workflow={workflow}
            blueprints={blueprints}
            onUpdateEdge={updateEdge}
            onUpdateNode={updateNode}
            onUpdateWorkflow={updateWorkflow}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </div>
      </div>
    </>
  )
}
