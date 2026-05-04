import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtShort } from '../utils/dates'

const STATUS_META = {
  open:        { label: 'Open',        color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  in_progress: { label: 'In Progress', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  resolved:    { label: 'Resolved',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  closed:      { label: 'Closed',      color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

const SEVERITY_META = {
  critical: { label: 'Critical', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  high:     { label: 'High',     color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  medium:   { label: 'Medium',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  low:      { label: 'Low',      color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, borderRadius: 5, padding: '2px 8px', letterSpacing: '0.02em' }}>
      {m.label}
    </span>
  )
}

function SeverityBadge({ severity }) {
  const m = SEVERITY_META[severity] || { label: severity, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, borderRadius: 5, padding: '2px 8px', letterSpacing: '0.02em' }}>
      {m.label}
    </span>
  )
}

function CreateModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('open')
  const [severity, setSeverity] = useState('medium')
  const [assignee, setAssignee] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/cases', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, status, severity, assignee: assignee.trim() || null }),
      })
      if (r.ok) {
        const created = await r.json()
        onCreate(created)
      }
    } finally { setSaving(false) }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', background: '#111118', border: '1px solid #1f2937',
    borderRadius: 7, color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = { color: '#6b7280', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <form onSubmit={submit} style={{ background: '#0d0d14', border: '1px solid #1f2937', borderRadius: 12, padding: 24, width: 480, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>New Case</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div>
          <label style={labelStyle}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="Brief case title…" autoFocus required />
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, height: 72, resize: 'vertical' }} placeholder="Optional — investigation context, initial findings…" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              {Object.entries(STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Severity</label>
            <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              {Object.entries(SEVERITY_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Assignee</label>
            <input value={assignee} onChange={e => setAssignee(e.target.value)} style={inputStyle} placeholder="username" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ padding: '7px 16px', background: '#1f2937', border: 'none', borderRadius: 7, color: '#9ca3af', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim()} style={{ padding: '7px 16px', background: saving ? '#1f2937' : '#4f46e5', border: 'none', borderRadius: 7, color: saving ? '#4b5563' : '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Creating…' : 'Create Case'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Cases() {
  const navigate = useNavigate()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState([])
  const [severityFilter, setSeverityFilter] = useState([])
  const [q, setQ] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    const params = new URLSearchParams()
    statusFilter.forEach(s => params.append('status', s))
    severityFilter.forEach(s => params.append('severity', s))
    if (q) params.set('q', q)
    try {
      const r = await fetch(`/api/cases?${params}`, { credentials: 'include' })
      setCases(await r.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [statusFilter, severityFilter, q])

  const deleteCase = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this case?')) return
    await fetch(`/api/cases/${id}`, { method: 'DELETE', credentials: 'include' })
    setCases(prev => prev.filter(c => c.id !== id))
  }

  const toggleStatus = s => setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  const toggleSeverity = s => setSeverityFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const filterBtnStyle = (active, color) => ({
    padding: '4px 12px', borderRadius: 20, border: `1px solid ${active ? color : '#1f2937'}`,
    background: active ? `${color}18` : 'transparent', color: active ? color : '#6b7280',
    fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
  })

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={created => { setCases(prev => [created, ...prev]); setShowCreate(false); navigate(`/cases/${created.id}`) }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Cases</h1>
          <p style={{ color: '#4b5563', fontSize: 13, margin: '4px 0 0' }}>Investigation and incident tracking</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          background: '#4f46e5', border: 'none', borderRadius: 8,
          color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="6.5" y1="1" x2="6.5" y2="12" /><line x1="1" y1="6.5" x2="12" y2="6.5" />
          </svg>
          New Case
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', marginRight: 8 }}>
          <svg style={{ position: 'absolute', left: 9, top: 8, pointerEvents: 'none' }} width="13" height="13" fill="none" stroke="#4b5563" strokeWidth="1.8">
            <circle cx="5.5" cy="5.5" r="4.5" /><line x1="9.5" y1="9.5" x2="12" y2="12" />
          </svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cases…" style={{
            paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
            background: '#111118', border: '1px solid #1f2937', borderRadius: 7,
            color: '#e2e8f0', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', width: 180,
          }} />
        </div>
        <span style={{ color: '#374151', fontSize: 11 }}>Status:</span>
        {Object.entries(STATUS_META).map(([v, m]) => (
          <button key={v} onClick={() => toggleStatus(v)} style={filterBtnStyle(statusFilter.includes(v), m.color)}>{m.label}</button>
        ))}
        <span style={{ color: '#374151', fontSize: 11, marginLeft: 8 }}>Severity:</span>
        {Object.entries(SEVERITY_META).map(([v, m]) => (
          <button key={v} onClick={() => toggleSeverity(v)} style={filterBtnStyle(severityFilter.includes(v), m.color)}>{m.label}</button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: '#4b5563', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      ) : cases.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#374151' }}>
          <svg width="40" height="40" fill="none" stroke="#1f2937" strokeWidth="1.5" viewBox="0 0 24 24" style={{ marginBottom: 12 }}>
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div style={{ fontSize: 14, color: '#374151' }}>No cases yet</div>
          <div style={{ fontSize: 12, color: '#1f2937', marginTop: 4 }}>Click "New Case" to open your first investigation</div>
        </div>
      ) : (
        <div style={{ border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f2937', background: '#0d0d14' }}>
                {['Title', 'Status', 'Severity', 'Assignee', 'Created', ''].map(h => (
                  <th key={h} style={{ padding: '9px 14px', color: '#4b5563', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cases.map((c, i) => (
                <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)}
                  style={{ borderBottom: i < cases.length - 1 ? '1px solid #111118' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#0d0d14'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '11px 14px', color: '#e2e8f0', fontSize: 13, fontWeight: 500, maxWidth: 320 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  </td>
                  <td style={{ padding: '11px 14px' }}><StatusBadge status={c.status} /></td>
                  <td style={{ padding: '11px 14px' }}><SeverityBadge severity={c.severity} /></td>
                  <td style={{ padding: '11px 14px', color: c.assignee ? '#94a3b8' : '#374151', fontSize: 12 }}>
                    {c.assignee || '—'}
                  </td>
                  <td style={{ padding: '11px 14px', color: '#4b5563', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {fmtShort(c.created_at)}
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    <button onClick={e => deleteCase(c.id, e)} style={{
                      background: 'none', border: 'none', color: '#374151', cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
                      transition: 'color 0.15s', fontSize: 14,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#374151'}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
