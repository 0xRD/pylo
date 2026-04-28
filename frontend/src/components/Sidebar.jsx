import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity,
  Boxes,
  Braces,
  CircuitBoard,
  Database,
  GitBranch,
  KeyRound,
  LogOut,
  PlayCircle,
  Settings,
  Shield,
  UserCog,
  Workflow,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const links = [
  { to: '/blueprints', label: 'Blueprints', icon: Boxes },
  { to: '/entries', label: 'Entries', icon: Database },
  { to: '/pybooks', label: 'PyBooks', icon: Braces },
  { to: '/workflows', label: 'Workflows', icon: GitBranch },
  { to: '/runs', label: 'Runs', icon: PlayCircle },
  { to: '/automations', label: 'Automations', icon: Workflow },
  { to: '/secrets', label: 'Secrets', icon: KeyRound },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
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
      <aside className="w-60 bg-[#191a21] border-r border-[#343746] flex flex-col shadow-2xl shadow-black/20">
        <div className="px-4 py-5 border-b border-[#343746]">
          <NavLink to="/" className="flex items-center gap-3 text-gray-100 hover:text-[#bd93f9] transition-colors">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-[#282a36] border border-[#44475a] text-[#8be9fd]">
              <CircuitBoard size={18} />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight">Pylo</span>
              <span className="block text-[11px] text-[#6272a4]">Automation console</span>
            </span>
          </NavLink>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors border ${
                  isActive
                    ? 'bg-[#44475a] border-[#6272a4] text-[#f8f8f2]'
                    : 'border-transparent text-[#a7abc4] hover:bg-[#282a36] hover:text-[#f8f8f2]'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors border ${
                  isActive
                    ? 'bg-[#44475a] border-[#6272a4] text-[#f8f8f2]'
                    : 'border-transparent text-[#a7abc4] hover:bg-[#282a36] hover:text-[#f8f8f2]'
                }`
              }
            >
              <UserCog size={17} />
              Users
            </NavLink>
          )}
        </nav>
        <div className="px-3 py-3 border-t border-[#343746]">
          <div className="rounded-md bg-[#282a36] border border-[#343746] px-3 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded bg-[#191a21] text-[#50fa7b]">
                  <Shield size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#f8f8f2] truncate">{user?.username}</p>
                  <p className="text-[11px] uppercase tracking-wide text-[#6272a4]">{user?.role}</p>
                </div>
              </div>
              <button onClick={handleLogout} title="Sign out" className="text-[#6272a4] hover:text-[#ff79c6] transition-colors ml-2 shrink-0">
                <LogOut size={15} />
              </button>
            </div>
            <button
              onClick={() => setShowChangePwd(true)}
              className="text-xs text-[#8be9fd] hover:text-[#bd93f9] transition-colors"
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
