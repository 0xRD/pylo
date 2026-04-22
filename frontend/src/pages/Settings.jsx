import { useEffect, useState } from 'react'
import { runsApi } from '../api/pybooks'
import { useAuth } from '../context/AuthContext'

const settingsApi = {
  get: () => fetch('/api/settings', { credentials: 'include' }).then(r => r.json()),
  update: (data) => fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
}

export default function Settings() {
  const { isAdmin } = useAuth()
  const [settings, setSettings] = useState(null)
  const [maxConcurrent, setMaxConcurrent] = useState(5)
  const [jwtHours, setJwtHours] = useState(24)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    settingsApi.get().then(s => {
      setSettings(s)
      setMaxConcurrent(s.max_concurrent_runs)
      setJwtHours(s.jwt_expire_hours ?? 24)
    }).catch(() => {})
  }, [])

  const isDirty = maxConcurrent !== settings?.max_concurrent_runs || jwtHours !== (settings?.jwt_expire_hours ?? 24)

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      const updated = await settingsApi.update({
        max_concurrent_runs: maxConcurrent,
        jwt_expire_hours: jwtHours,
      })
      setSettings(s => ({
        ...s,
        ...(updated.max_concurrent_runs !== undefined && { max_concurrent_runs: updated.max_concurrent_runs }),
        ...(updated.jwt_expire_hours !== undefined && { jwt_expire_hours: updated.jwt_expire_hours }),
      }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-100 mb-6">Settings</h1>

      <section className="space-y-6">
        <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-200 mb-4">PyBook execution</h2>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400">Max concurrent runs</label>
                <span className="text-sm font-mono text-indigo-300">{maxConcurrent}</span>
              </div>
              <input
                type="range" min={1} max={20} value={maxConcurrent}
                onChange={e => setMaxConcurrent(Number(e.target.value))}
                disabled={!isAdmin}
                className="w-full accent-indigo-500 disabled:opacity-50"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>1</span>
                <span className="text-gray-500">How many PyBooks can execute Docker containers simultaneously</span>
                <span>20</span>
              </div>
            </div>

            {settings && (
              <div className="flex items-center gap-4 pt-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span>{settings.running ?? 0} currently running</span>
                </div>
                {(settings.queued ?? 0) > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span>{settings.queued} waiting in queue</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Security</h2>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">Session duration (hours)</label>
              <span className="text-sm font-mono text-indigo-300">{jwtHours}h</span>
            </div>
            <input
              type="range" min={1} max={720} step={1} value={jwtHours}
              onChange={e => setJwtHours(Number(e.target.value))}
              disabled={!isAdmin}
              className="w-full accent-indigo-500 disabled:opacity-50"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>1h</span>
              <span className="text-gray-500">How long a login session lasts before requiring re-authentication</span>
              <span>720h</span>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving || !isDirty}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
              {saving ? 'Saving…' : 'Apply'}
            </button>
            {saved && <span className="text-xs text-green-400">Saved — takes effect immediately</span>}
            {isDirty && !saved && <span className="text-xs text-gray-500">Unsaved changes</span>}
          </div>
        )}

        <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-200 mb-1">Configuration note</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            Default values can also be set via environment variables:{' '}
            <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded">PYLO_MAX_CONCURRENT_RUNS</code>{' '}
            and{' '}
            <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded">JWT_EXPIRE_HOURS</code>.
            Changes made here are persisted in the database and override the environment variable.
          </p>
        </div>
      </section>
    </div>
  )
}
