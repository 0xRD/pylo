import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

async function validateInvite(token) {
  const res = await fetch(`/api/auth/invite/${token}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Invalid or expired invitation')
  return res.json()
}

async function acceptInvite(token, username, password) {
  const res = await fetch(`/api/auth/invite/${token}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || 'Failed to create account')
  }
  return res.json()
}

export default function InviteAccept() {
  const { token } = useParams()
  const { login } = useAuth()
  const navigate = useNavigate()

  const [invite, setInvite] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    validateInvite(token)
      .then(setInvite)
      .catch(() => setInvalid(true))
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const user = await acceptInvite(token, username, password)
      // cookie is set by the server — update auth context
      window.location.href = '/'
    } catch (err) {
      try {
        const detail = JSON.parse(err.message)
        setError(detail.detail || err.message)
      } catch {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const expiresAt = invite ? new Date(invite.expires_at) : null

  if (invalid) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-indigo-400 tracking-tight mb-4">Pylo</h1>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <p className="text-sm text-red-400">This invitation link is invalid or has expired.</p>
            <p className="text-xs text-gray-500 mt-2">Ask an admin for a new one.</p>
          </div>
        </div>
      </div>
    )
  }

  if (!invite) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-sm text-gray-500">Checking invitation…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-indigo-400 tracking-tight">Pylo</h1>
          <p className="text-sm text-gray-500 mt-1">You've been invited to join</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Create your account</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                invite.role === 'admin' ? 'bg-indigo-900/50 text-indigo-300' : 'bg-gray-800 text-gray-400'
              }`}>{invite.role}</span>
              {expiresAt && (
                <span className="text-xs text-gray-600">
                  Expires {expiresAt.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Username</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-sm px-3 py-2 text-sm text-gray-100 focus:outline-hidden focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-sm px-3 py-2 text-sm text-gray-100 focus:outline-hidden focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Confirm password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-sm px-3 py-2 text-sm text-gray-100 focus:outline-hidden focus:border-indigo-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-sm text-sm font-medium transition-colors"
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
