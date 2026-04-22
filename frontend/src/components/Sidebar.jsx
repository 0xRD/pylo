import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const links = [
  { to: '/blueprints', label: 'Blueprints', icon: '⬡' },
  { to: '/entries', label: 'Entries', icon: '◈' },
  { to: '/pybooks', label: 'PyBooks', icon: '📖' },
  { to: '/runs', label: 'Runs', icon: '▶' },
  { to: '/secrets', label: 'Secrets', icon: '🔑' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Sidebar() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
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
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
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
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`
            }
          >
            <span className="text-base leading-none">👥</span>
            Users
          </NavLink>
        )}
      </nav>
      <div className="px-3 py-3 border-t border-gray-800">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-300 truncate">{user?.username}</p>
            <p className="text-xs text-gray-600">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-2 shrink-0"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
