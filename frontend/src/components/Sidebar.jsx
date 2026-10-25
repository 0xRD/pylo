import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity,
  BookOpen,
  Boxes,
  Braces,
  ChevronsLeft,
  ChevronsRight,
  CircuitBoard,
  Database,
  Gauge,
  GitBranch,
  GitCommit,
  GitPullRequest,
  KeyRound,
  LayoutDashboard,
  LogOut,
  PlayCircle,
  Settings,
  Shield,
  UserCog,
  Workflow,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useGitops } from '../context/GitopsContext'
import { useUi } from '../context/UiContext'
import CommitPanel from './CommitPanel'
import SyncPanel from './SyncPanel'

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/blueprints', label: 'Blueprints', icon: Boxes },
  { to: '/entries', label: 'Entries', icon: Database },
  { to: '/pybooks', label: 'PyBooks', icon: Braces },
  { to: '/workflows', label: 'Workflows', icon: GitBranch },
  { to: '/runs', label: 'Runs', icon: PlayCircle },
  { to: '/automations', label: 'Automations', icon: Workflow },
  { to: '/secrets', label: 'Secrets', icon: KeyRound },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/wiki', label: 'Wiki', icon: BookOpen },
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

        {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-sm px-3 py-2">{error}</div>}
        {saved && <div className="text-xs text-green-400 bg-green-900/20 border border-green-800 rounded-sm px-3 py-2">Password changed.</div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Current password</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-sm px-3 py-2 text-sm text-gray-100 focus:outline-hidden focus:border-indigo-500" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">New password</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-sm px-3 py-2 text-sm text-gray-100 focus:outline-hidden focus:border-indigo-500" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-sm px-3 py-2 text-sm text-gray-100 focus:outline-hidden focus:border-indigo-500" required />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading || saved}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-sm text-sm font-medium transition-colors">
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-sm text-sm transition-colors">
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
  const { isProd, isDev, configured, pendingCount, remoteAhead } = useGitops()
  const { sidebarCollapsed, toggleSidebar, compact, toggleDensity } = useUi()
  const navigate = useNavigate()
  const [showChangePwd, setShowChangePwd] = useState(false)
  const [showCommit, setShowCommit] = useState(false)
  const [showSync, setShowSync] = useState(false)

  const collapsed = sidebarCollapsed

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const navClass = ({ isActive }) =>
    `flex items-center rounded-md text-sm transition-colors border ${
      collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
    } ${
      isActive
        ? 'bg-[#44475a] border-[#6272a4] text-[#f8f8f2]'
        : 'border-transparent text-[#a7abc4] hover:bg-[#282a36] hover:text-[#f8f8f2]'
    }`

  return (
    <>
      <aside className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 bg-[#191a21] border-r border-[#343746] flex flex-col shadow-2xl shadow-black/20 transition-[width] duration-200`}>
        <div className={`border-b border-[#343746] ${collapsed ? 'px-2 py-4' : 'px-4 py-5'}`}>
          <div className="flex items-center justify-between gap-2">
            <NavLink to="/" title="Pylo" className={`flex items-center gap-3 text-gray-100 hover:text-[#bd93f9] transition-colors ${collapsed ? 'mx-auto' : ''}`}>
              <span className="grid h-9 w-9 place-items-center rounded-md bg-[#282a36] border border-[#44475a] text-[#8be9fd] shrink-0">
                <CircuitBoard size={18} />
              </span>
              {!collapsed && (
                <span>
                  <span className="block text-base font-semibold tracking-tight">Pylo</span>
                  <span className="block text-[11px] text-[#6272a4]">Automation console</span>
                </span>
              )}
            </NavLink>
            {!collapsed && (
              <button
                onClick={toggleSidebar}
                title="Collapse sidebar"
                className="grid h-7 w-7 place-items-center rounded-sm text-[#6272a4] hover:bg-[#282a36] hover:text-[#f8f8f2] transition-colors"
              >
                <ChevronsLeft size={16} />
              </button>
            )}
          </div>
          {collapsed && (
            <button
              onClick={toggleSidebar}
              title="Expand sidebar"
              className="mt-3 grid h-7 w-full place-items-center rounded-sm text-[#6272a4] hover:bg-[#282a36] hover:text-[#f8f8f2] transition-colors"
            >
              <ChevronsRight size={16} />
            </button>
          )}
        </div>

        {/* Prod environment banner */}
        {isProd && (
          collapsed ? (
            <div title="Production — read-only" className="mx-auto mt-3 grid h-8 w-8 place-items-center rounded-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
              <GitBranch size={14} />
            </div>
          ) : (
            <div className="mx-3 mt-3 px-3 py-2 rounded-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-semibold flex items-center gap-2">
              <GitBranch size={12} />
              Production — read-only
            </div>
          )
        )}

        <nav className={`flex-1 overflow-y-auto py-4 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={collapsed ? label : undefined} className={navClass}>
              <Icon size={17} className="shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/users" title={collapsed ? 'Users' : undefined} className={navClass}>
              <UserCog size={17} className="shrink-0" />
              {!collapsed && 'Users'}
            </NavLink>
          )}

          {/* GitOps actions — only shown when configured */}
          {configured && isAdmin && isDev && (
            <button
              onClick={() => setShowCommit(true)}
              title={collapsed ? `Commit${pendingCount > 0 ? ` (${pendingCount})` : ''}` : undefined}
              className={`relative w-full flex items-center rounded-md text-sm transition-colors border border-transparent text-[#a7abc4] hover:bg-[#282a36] hover:text-[#bd93f9] ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}`}
            >
              <GitCommit size={17} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left">Commit</span>}
              {pendingCount > 0 && (
                collapsed ? (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#bd93f9]" />
                ) : (
                  <span className="bg-[#bd93f9] text-[#282a36] text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )
              )}
            </button>
          )}

          {configured && isAdmin && isProd && (
            <button
              onClick={() => setShowSync(true)}
              title={collapsed ? 'Sync' : undefined}
              className={`relative w-full flex items-center rounded-md text-sm transition-colors border border-transparent text-[#a7abc4] hover:bg-[#282a36] hover:text-[#50fa7b] ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}`}
            >
              <GitPullRequest size={17} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left">Sync</span>}
              {remoteAhead && (
                collapsed ? (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#50fa7b]" />
                ) : (
                  <span className="bg-[#50fa7b] text-[#282a36] text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    ↓
                  </span>
                )
              )}
            </button>
          )}
        </nav>

        <div className={`border-t border-[#343746] ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <button onClick={toggleDensity} title={compact ? 'Comfortable density' : 'Compact density'}
                className="grid h-8 w-8 place-items-center rounded-sm text-[#6272a4] hover:bg-[#282a36] hover:text-[#f8f8f2] transition-colors">
                <Gauge size={15} />
              </button>
              <span title={`${user?.username} — ${user?.role}`} className="grid h-8 w-8 place-items-center rounded-sm bg-[#282a36] text-[#50fa7b]">
                <Shield size={14} />
              </span>
              <button onClick={handleLogout} title="Sign out" className="grid h-8 w-8 place-items-center rounded-sm text-[#6272a4] hover:bg-[#282a36] hover:text-[#ff79c6] transition-colors">
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <div className="rounded-md bg-[#282a36] border border-[#343746] px-3 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-sm bg-[#191a21] text-[#50fa7b]">
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
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowChangePwd(true)}
                  className="text-xs text-[#8be9fd] hover:text-[#bd93f9] transition-colors"
                >
                  Change password
                </button>
                <button
                  onClick={toggleDensity}
                  title="Toggle density"
                  className="inline-flex items-center gap-1 text-xs text-[#6272a4] hover:text-[#f8f8f2] transition-colors"
                >
                  <Gauge size={13} />
                  {compact ? 'Compact' : 'Comfortable'}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
      {showCommit && <CommitPanel onClose={() => setShowCommit(false)} />}
      {showSync && <SyncPanel onClose={() => setShowSync(false)} />}
    </>
  )
}
