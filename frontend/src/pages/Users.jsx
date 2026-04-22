import { useEffect, useState } from 'react'
import { usersApi } from '../api/auth'
import { useAuth } from '../context/AuthContext'

function RoleBadge({ role }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
      role === 'admin' ? 'bg-indigo-900/50 text-indigo-300' : 'bg-gray-800 text-gray-400'
    }`}>
      {role}
    </span>
  )
}

function CreateUserModal({ onClose, onCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await usersApi.create({ username, password, role })
      onCreated(user)
    } catch (err) {
      setError(err.message || 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">New user</h2>

        {error && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
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
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Users() {
  const { user: currentUser, isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editRole, setEditRole] = useState('')

  useEffect(() => {
    if (isAdmin) {
      usersApi.list().then(setUsers).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
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

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500">Admin access required.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-100">Users</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition-colors"
        >
          + New user
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-2">
          {users.map(user => (
            <div key={user.id} className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-100 truncate">{user.username}</span>
                  {user.username === currentUser?.username && (
                    <span className="text-xs text-gray-600">(you)</span>
                  )}
                  {!user.is_active && (
                    <span className="text-xs text-yellow-600">disabled</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {editingId === user.id ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={editRole}
                        onChange={e => setEditRole(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-100"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button onClick={() => handleRoleChange(user)} className="text-xs text-indigo-400 hover:text-indigo-300">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(user.id); setEditRole(user.role) }}
                      className="flex items-center gap-1 group"
                    >
                      <RoleBadge role={user.role} />
                      <span className="text-xs text-gray-600 group-hover:text-gray-400 transition-colors">edit</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {user.username !== currentUser?.username && (
                  <>
                    <button
                      onClick={() => handleToggleActive(user)}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {user.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(user) => { setUsers(u => [...u, user]); setShowCreate(false) }}
        />
      )}
    </div>
  )
}
