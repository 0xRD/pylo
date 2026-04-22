import { useEffect, useState } from 'react'
import { usersApi } from '../api/auth'
import { useAuth } from '../context/AuthContext'

const invitationsApi = {
  list: () => fetch('/api/invitations', { credentials: 'include' }).then(r => r.json()),
  create: (role) => fetch('/api/invitations', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() }),
  revoke: (id) => fetch(`/api/invitations/${id}`, { method: 'DELETE', credentials: 'include' })
    .then(r => { if (!r.ok) throw new Error(r.statusText) }),
}

function RoleBadge({ role }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
      role === 'admin' ? 'bg-indigo-900/50 text-indigo-300' : 'bg-gray-800 text-gray-400'
    }`}>{role}</span>
  )
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  // Fallback for Firefox on HTTP
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
  return Promise.resolve()
}

function InviteLinkModal({ invite, onClose }) {
  const link = `${window.location.origin}/invite/${invite.token}`
  const [copied, setCopied] = useState(false)

  const copy = () => {
    copyToClipboard(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const expires = new Date(invite.expires_at)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Invitation link created</h2>
          <p className="text-xs text-gray-500 mt-1">Share this link with the user. It expires on {expires.toLocaleString()}.</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none"
          />
          <button
            onClick={copy}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <button onClick={onClose} className="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
          Close
        </button>
      </div>
    </div>
  )
}

function InviteModal({ onClose, onCreated }) {
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    setLoading(true); setError('')
    try {
      const inv = await invitationsApi.create(role)
      onCreated(inv)
    } catch (err) {
      setError(err.message || 'Failed to create invitation')
    } finally {
      setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Invite user</h2>

        {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}

        <div>
          <label className="block text-xs text-gray-400 mb-1">Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <p className="text-xs text-gray-500">A unique link will be generated. It expires in 24 hours and can only be used once.</p>

        <div className="flex gap-2">
          <button onClick={handleCreate} disabled={loading}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
            {loading ? 'Generating…' : 'Generate link'}
          </button>
          <button onClick={onClose} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function AdminPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')
    try {
      await usersApi.update(user.id, { password })
      setSaved(true)
      setTimeout(onClose, 1200)
    } catch (err) {
      setError(err.message || 'Failed to update password')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Reset password — {user.username}</h2>

        {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
        {saved && <div className="text-xs text-green-400 bg-green-900/20 border border-green-800 rounded px-3 py-2">Password updated.</div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">New password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Confirm password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" required />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading || saved}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function timeLeft(expiresAt) {
  const diff = new Date(expiresAt) - Date.now()
  if (diff <= 0) return 'expired'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

export default function Users() {
  const { user: currentUser, isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [pendingInvite, setPendingInvite] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editRole, setEditRole] = useState('')
  const [passwordTarget, setPasswordTarget] = useState(null)

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return }
    Promise.all([usersApi.list(), invitationsApi.list()])
      .then(([u, i]) => { setUsers(u); setInvitations(i) })
      .finally(() => setLoading(false))
  }, [isAdmin])

  const handleDelete = async (user) => {
    if (!confirm(`Delete user "${user.username}"?`)) return
    await usersApi.delete(user.id)
    setUsers(u => u.filter(x => x.id !== user.id))
  }

  const handleRoleChange = async (user) => {
    const updated = await usersApi.update(user.id, { role: editRole })
    setUsers(u => u.map(x => x.id === updated.id ? updated : x))
    setEditingId(null)
  }

  const handleToggleActive = async (user) => {
    const updated = await usersApi.update(user.id, { is_active: !user.is_active })
    setUsers(u => u.map(x => x.id === updated.id ? updated : x))
  }

  const handleInviteCreated = (inv) => {
    setInvitations(prev => [inv, ...prev])
    setShowInvite(false)
    setPendingInvite(inv)
  }

  const handleRevoke = async (inv) => {
    await invitationsApi.revoke(inv.id)
    setInvitations(prev => prev.filter(i => i.id !== inv.id))
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500">Admin access required.</p>
      </div>
    )
  }

  const pendingInvites = invitations.filter(i => !i.used_at && new Date(i.expires_at) > Date.now())
  const usedInvites = invitations.filter(i => i.used_at || new Date(i.expires_at) <= Date.now())

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Users */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-100">Users</h1>
          <button onClick={() => setShowInvite(true)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition-colors">
            + Invite user
          </button>
        </div>

        {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
          <div className="space-y-2">
            {users.map(user => (
              <div key={user.id} className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-100 truncate">{user.username}</span>
                    {user.username === currentUser?.username && <span className="text-xs text-gray-600">(you)</span>}
                    {!user.is_active && <span className="text-xs text-yellow-600">disabled</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {editingId === user.id ? (
                      <div className="flex items-center gap-1.5">
                        <select value={editRole} onChange={e => setEditRole(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-100">
                          <option value="viewer">Viewer</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button onClick={() => handleRoleChange(user)} className="text-xs text-indigo-400 hover:text-indigo-300">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingId(user.id); setEditRole(user.role) }} className="flex items-center gap-1 group">
                        <RoleBadge role={user.role} />
                        <span className="text-xs text-gray-600 group-hover:text-gray-400 transition-colors">edit</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {user.username !== currentUser?.username ? (
                    <>
                      <button onClick={() => setPasswordTarget(user)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Reset pwd</button>
                      <button onClick={() => handleToggleActive(user)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                        {user.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => handleDelete(user)} className="text-xs text-red-500 hover:text-red-400 transition-colors">Delete</button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Pending invitations</h2>
          <div className="space-y-2">
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <RoleBadge role={inv.role} />
                    <span className="text-xs text-gray-500">by {inv.created_by}</span>
                    <span className="text-xs text-yellow-600">{timeLeft(inv.expires_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setPendingInvite(inv)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Copy link</button>
                  <button onClick={() => handleRevoke(inv)} className="text-xs text-red-500 hover:text-red-400 transition-colors">Revoke</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Used / expired invitations */}
      {usedInvites.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-3">Used / expired</h2>
          <div className="space-y-1">
            {usedInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-50">
                <RoleBadge role={inv.role} />
                {inv.used_by
                  ? <span className="text-xs text-gray-500">Used by <span className="text-gray-400">{inv.used_by}</span></span>
                  : <span className="text-xs text-gray-500">Expired</span>
                }
                <button onClick={() => handleRevoke(inv)} className="ml-auto text-xs text-gray-600 hover:text-red-400 transition-colors">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onCreated={handleInviteCreated} />}
      {pendingInvite && <InviteLinkModal invite={pendingInvite} onClose={() => setPendingInvite(null)} />}
      {passwordTarget && <AdminPasswordModal user={passwordTarget} onClose={() => setPasswordTarget(null)} />}
    </div>
  )
}
