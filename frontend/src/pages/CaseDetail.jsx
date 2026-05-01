import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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

const LINK_TYPE_META = {
  entry:        { label: 'Entry',        color: '#60a5fa', path: '/entries' },
  pybook_run:   { label: 'PyBook Run',   color: '#a78bfa', path: '/runs' },
  workflow_run: { label: 'Workflow Run', color: '#34d399', path: '/runs' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, borderRadius: 5, padding: '2px 8px' }}>
      {m.label}
    </span>
  )
}

function SeverityBadge({ severity }) {
  const m = SEVERITY_META[severity] || { label: severity, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, borderRadius: 5, padding: '2px 8px' }}>
      {m.label}
    </span>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ caseData, onUpdate }) {
  const [description, setDescription] = useState(caseData.description || '')
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    setDescription(caseData.description || '')
  }, [caseData.id])

  const autoSave = val => {
    setDescription(val)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await fetch(`/api/cases/${caseData.id}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: val || null }),
        })
        onUpdate({ description: val || null })
      } finally { setSaving(false) }
    }, 900)
  }

  const labelStyle = { color: '#4b5563', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24 }}>
      {/* Description */}
      <div>
        <label style={labelStyle}>
          Description
          {saving && <span style={{ color: '#818cf8', fontWeight: 400, marginLeft: 8, textTransform: 'none' }}>saving…</span>}
        </label>
        <textarea
          value={description}
          onChange={e => autoSave(e.target.value)}
          placeholder="Investigation context, initial findings, notes…"
          style={{
            width: '100%', minHeight: 200, padding: '10px 12px',
            background: '#111118', border: '1px solid #1f2937', borderRadius: 8,
            color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Metadata */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: '#0d0d14', border: '1px solid #1f2937', borderRadius: 8, padding: 16 }}>
          <div style={{ color: '#4b5563', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>Details</div>
          {[
            ['Created by', caseData.created_by],
            ['Created', fmtShort(caseData.created_at)],
            ['Updated', fmtShort(caseData.updated_at)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
              <span style={{ color: '#4b5563', fontSize: 12 }}>{k}</span>
              <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace', textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Linked Items Tab ──────────────────────────────────────────────────────────

function LinkedItemsTab({ caseId, links, onLinksChange }) {
  const navigate = useNavigate()
  const [linkType, setLinkType] = useState('entry')
  const [linkId, setLinkId] = useState('')
  const [adding, setAdding] = useState(false)

  const addLink = async e => {
    e.preventDefault()
    if (!linkId.trim()) return
    setAdding(true)
    try {
      const r = await fetch(`/api/cases/${caseId}/links`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_type: linkType, link_id: linkId.trim() }),
      })
      if (r.ok) {
        const newLink = await r.json()
        onLinksChange([...links, newLink])
        setLinkId('')
      }
    } finally { setAdding(false) }
  }

  const removeLink = async (linkId) => {
    await fetch(`/api/cases/${caseId}/links/${linkId}`, { method: 'DELETE', credentials: 'include' })
    onLinksChange(links.filter(l => l.id !== linkId))
  }

  const selectStyle = {
    padding: '7px 10px', background: '#111118', border: '1px solid #1f2937',
    borderRadius: 7, color: '#e2e8f0', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  }

  return (
    <div>
      {/* Add link form */}
      <form onSubmit={addLink} style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <select value={linkType} onChange={e => setLinkType(e.target.value)} style={selectStyle}>
          {Object.entries(LINK_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
        <input
          value={linkId} onChange={e => setLinkId(e.target.value)}
          placeholder="Paste ID to link…"
          style={{ flex: 1, padding: '7px 10px', background: '#111118', border: '1px solid #1f2937', borderRadius: 7, color: '#e2e8f0', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
        />
        <button type="submit" disabled={adding || !linkId.trim()} style={{
          padding: '7px 14px', background: adding ? '#1f2937' : '#4f46e5', border: 'none', borderRadius: 7,
          color: adding ? '#4b5563' : '#fff', fontSize: 12.5, fontWeight: 600, cursor: adding ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        }}>
          {adding ? 'Linking…' : 'Link'}
        </button>
      </form>

      {/* Links list */}
      {links.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#374151', fontSize: 13 }}>
          No linked items — paste an entry or run ID above to link it.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {links.map(lk => {
            const meta = LINK_TYPE_META[lk.link_type] || { label: lk.link_type, color: '#6b7280', path: '/' }
            return (
              <div key={lk.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: '#0d0d14', border: '1px solid #1f2937',
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: meta.color, background: `${meta.color}18`, borderRadius: 4, padding: '2px 7px', flexShrink: 0 }}>
                  {meta.label}
                </span>
                <span style={{ flex: 1, color: '#e2e8f0', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lk.label || lk.link_id}
                </span>
                <span style={{ color: '#374151', fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}>
                  {lk.link_id.slice(0, 8)}…
                </span>
                <button onClick={() => navigate(`${meta.path}/${lk.link_id}`)} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
                  onMouseLeave={e => e.currentTarget.style.color = '#4b5563'}>
                  Open ↗
                </button>
                <button onClick={() => removeLink(lk.id)} style={{ background: 'none', border: 'none', color: '#374151', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontSize: 14 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = '#374151'}>
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Comments Tab ──────────────────────────────────────────────────────────────

function CommentsTab({ caseId, comments, onCommentsChange }) {
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  const post = async e => {
    e.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    try {
      const r = await fetch(`/api/cases/${caseId}/comments`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      })
      if (r.ok) {
        const comment = await r.json()
        onCommentsChange([...comments, comment])
        setBody('')
      }
    } finally { setPosting(false) }
  }

  const del = async (commentId) => {
    if (!confirm('Delete this comment?')) return
    await fetch(`/api/cases/${caseId}/comments/${commentId}`, { method: 'DELETE', credentials: 'include' })
    onCommentsChange(comments.filter(c => c.id !== commentId))
  }

  return (
    <div>
      {/* Comment thread */}
      {comments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#374151', fontSize: 13, marginBottom: 16 }}>
          No comments yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {comments.map(c => (
            <div key={c.id} style={{ background: '#0d0d14', border: '1px solid #1f2937', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#0d0d14', flexShrink: 0 }}>
                    {c.author[0]?.toUpperCase()}
                  </div>
                  <span style={{ color: '#94a3b8', fontSize: 12.5, fontWeight: 500 }}>{c.author}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#374151', fontSize: 11, fontFamily: 'monospace' }}>{fmtShort(c.created_at)}</span>
                  <button onClick={() => del(c.id)} style={{ background: 'none', border: 'none', color: '#374151', cursor: 'pointer', fontSize: 14, padding: '1px 4px', borderRadius: 3 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#374151'}>×</button>
                </div>
              </div>
              <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add comment */}
      <form onSubmit={post} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          value={body} onChange={e => setBody(e.target.value)}
          placeholder="Add a comment…"
          style={{
            width: '100%', minHeight: 80, padding: '10px 12px',
            background: '#111118', border: '1px solid #1f2937', borderRadius: 8,
            color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
          }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e) }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={posting || !body.trim()} style={{
            padding: '7px 16px', background: posting ? '#1f2937' : '#4f46e5', border: 'none', borderRadius: 7,
            color: posting ? '#4b5563' : '#fff', fontSize: 13, fontWeight: 600, cursor: posting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}>
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [caseData, setCaseData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState('')
  const saveTimer = useRef(null)

  useEffect(() => {
    fetch(`/api/cases/${id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setCaseData(data); setTitleVal(data.title); setLoading(false) })
      .catch(() => { navigate('/cases'); })
  }, [id])

  const patchField = async (field, value) => {
    const r = await fetch(`/api/cases/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (r.ok) {
      const updated = await r.json()
      setCaseData(prev => ({ ...prev, ...updated }))
    }
  }

  const saveTitle = async () => {
    if (!titleVal.trim() || titleVal === caseData.title) { setEditingTitle(false); return }
    await patchField('title', titleVal.trim())
    setEditingTitle(false)
  }

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090f' }}>
      <div style={{ color: '#4b5563', fontSize: 13 }}>Loading…</div>
    </div>
  )

  const smeta = STATUS_META[caseData.status] || STATUS_META.open
  const sevmeta = SEVERITY_META[caseData.severity] || SEVERITY_META.medium

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Back */}
      <button onClick={() => navigate('/cases')} style={{
        display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
        color: '#4b5563', cursor: 'pointer', padding: '4px 0', marginBottom: 20,
        fontSize: 12, fontFamily: 'inherit',
      }}
      onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
      onMouseLeave={e => e.currentTarget.style.color = '#4b5563'}>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="10 4 4 8 10 12" /></svg>
        Cases
      </button>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          {editingTitle ? (
            <input
              value={titleVal}
              onChange={e => setTitleVal(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleVal(caseData.title); setEditingTitle(false) } }}
              autoFocus
              style={{
                flex: 1, padding: '4px 8px', background: '#111118', border: '1px solid #818cf8',
                borderRadius: 6, color: '#f1f5f9', fontSize: 22, fontWeight: 700,
                fontFamily: 'inherit', outline: 'none', letterSpacing: '-0.02em',
              }}
            />
          ) : (
            <h1
              onClick={() => setEditingTitle(true)}
              title="Click to edit"
              style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', cursor: 'text', flex: 1 }}
            >
              {caseData.title}
            </h1>
          )}
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Status selector */}
          <select
            value={caseData.status}
            onChange={e => patchField('status', e.target.value)}
            style={{
              padding: '4px 10px', background: smeta.bg, border: `1px solid ${smeta.color}40`,
              borderRadius: 7, color: smeta.color, fontSize: 12, fontWeight: 600,
              fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            }}
          >
            {Object.entries(STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>

          {/* Severity selector */}
          <select
            value={caseData.severity}
            onChange={e => patchField('severity', e.target.value)}
            style={{
              padding: '4px 10px', background: sevmeta.bg, border: `1px solid ${sevmeta.color}40`,
              borderRadius: 7, color: sevmeta.color, fontSize: 12, fontWeight: 600,
              fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            }}
          >
            {Object.entries(SEVERITY_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>

          {/* Assignee */}
          <input
            defaultValue={caseData.assignee || ''}
            onBlur={e => { if (e.target.value !== (caseData.assignee || '')) patchField('assignee', e.target.value.trim() || null) }}
            placeholder="Unassigned"
            style={{
              padding: '4px 10px', background: '#111118', border: '1px solid #1f2937',
              borderRadius: 7, color: '#94a3b8', fontSize: 12, fontFamily: 'inherit', outline: 'none', width: 120,
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #1f2937', marginBottom: 24 }}>
        {[['overview', 'Overview'], ['links', `Linked Items${caseData.links.length ? ` (${caseData.links.length})` : ''}`], ['comments', `Comments${caseData.comments.length ? ` (${caseData.comments.length})` : ''}`]].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: 'none', borderBottom: `2px solid ${activeTab === tab ? '#818cf8' : 'transparent'}`,
            color: activeTab === tab ? '#e2e8f0' : '#4b5563', fontFamily: 'inherit',
            marginBottom: -1, transition: 'all 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          caseData={caseData}
          onUpdate={patch => setCaseData(prev => ({ ...prev, ...patch }))}
        />
      )}
      {activeTab === 'links' && (
        <LinkedItemsTab
          caseId={id}
          links={caseData.links}
          onLinksChange={links => setCaseData(prev => ({ ...prev, links }))}
        />
      )}
      {activeTab === 'comments' && (
        <CommentsTab
          caseId={id}
          comments={caseData.comments}
          onCommentsChange={comments => setCaseData(prev => ({ ...prev, comments }))}
        />
      )}
    </div>
  )
}
