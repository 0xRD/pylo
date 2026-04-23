import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const links = [
  { to: '/blueprints', label: 'Blueprints', icon: '⬡' },
  { to: '/entries', label: 'Entries', icon: '◈' },
  { to: '/pybooks', label: 'PyBooks', icon: '📖' },
  { to: '/runs', label: 'Runs', icon: '▶' },
  { to: '/secrets', label: 'Secrets', icon: '🔑' },
  { to: '/activity', label: 'Activity', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (next !== confirm) { setError('Passwords do not match'); return }
    if (next.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to change password')
      }
      setSaved(true)
      setTimeout(onClose, 1200)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Change password</h2>

        {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
        {saved && <div className="text-xs text-green-400 bg-green-900/20 border border-green-800 rounded px-3 py-2">Password changed.</div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Current password</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">New password</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500" required />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading || saved}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const [showChangePwd, setShowChangePwd] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <aside className="w-52 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-800">
          <NavLink to="/" className="text-lg font-bold text-indigo-400 tracking-tight hover:text-indigo-300 transition-colors">
            Pylo
          </NavLink>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {links.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
                }`
              }
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
                }`
              }
            >
              <span className="text-base leading-none">👥</span>
              Users
            </NavLink>
          )}
        </nav>
        <div className="px-3 py-3 border-t border-gray-800">
          <div className="px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-300 truncate">{user?.username}</p>
                <p className="text-xs text-gray-600">{user?.role}</p>
              </div>
              <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-2 shrink-0">
                Sign out
              </button>
            </div>
            <button
              onClick={() => setShowChangePwd(true)}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Change password
            </button>
          </div>
        </div>
      </aside>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
    </>
  )
}
