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


const systemApi = {
  info: () => fetch('/api/system/info', { credentials: 'include' }).then(r => r.json()),
  checkUpdate: () => fetch('/api/system/update/check', { credentials: 'include' }).then(r => r.json()),
  applyUpdate: () => fetch('/api/system/update/apply', { method: 'POST', credentials: 'include' }).then(r => r.json()),
  updateStatus: () => fetch('/api/system/update/status', { credentials: 'include' }).then(r => r.json()),
}

export default function Settings() {
  const { isAdmin } = useAuth()
  const [settings, setSettings] = useState(null)
  const [maxConcurrent, setMaxConcurrent] = useState(5)
  const [jwtHours, setJwtHours] = useState(24)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sysInfo, setSysInfo] = useState(null)
  const [updateCheck, setUpdateCheck] = useState(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateJob, setUpdateJob] = useState(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    systemApi.info().then(setSysInfo).catch(() => {})
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


        {isAdmin && (
          <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-200">System updates</h2>
                {sysInfo && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Current: <span className="font-mono text-gray-300">{sysInfo.short}</span>
                    {sysInfo.message && <span className="ml-2 text-gray-600 italic">{sysInfo.message}</span>}
                  </p>
                )}
              </div>
              <button
                onClick={async () => {
                  setUpdateChecking(true); setUpdateCheck(null)
                  try { setUpdateCheck(await systemApi.checkUpdate()) }
                  catch (e) { setUpdateCheck({ error: e.message }) }
                  finally { setUpdateChecking(false) }
                }}
                disabled={updateChecking}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs transition-colors">
                {updateChecking ? 'Checking…' : 'Check for updates'}
              </button>
            </div>

            {updateCheck && !updateCheck.error && (
              <div className={`p-3 rounded border text-xs ${updateCheck.up_to_date ? 'border-green-800 bg-green-950' : 'border-yellow-800 bg-yellow-950'}`}>
                {updateCheck.up_to_date ? (
                  <span className="text-green-400">✓ Up to date ({updateCheck.current_short})</span>
                ) : (
                  <div className="space-y-2">
                    <p className="text-yellow-300">Update available: <span className="font-mono">{updateCheck.current_short}</span> → <span className="font-mono">{updateCheck.latest_short}</span></p>
                    <button
                      onClick={async () => {
                        if (!confirm('Apply update? This will pull the latest code and rebuild containers. The app will be briefly unavailable.')) return
                        setApplying(true)
                        await systemApi.applyUpdate()
                        const poll = setInterval(async () => {
                          const st = await systemApi.updateStatus()
                          setUpdateJob(st)
                          if (st.status !== 'running') { clearInterval(poll); setApplying(false) }
                        }, 2000)
                      }}
                      disabled={applying}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded font-medium transition-colors">
                      {applying ? 'Applying…' : 'Apply update'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {updateCheck?.error && (
              <p className="text-xs text-red-400 bg-red-950 px-3 py-2 rounded">{updateCheck.error}</p>
            )}

            {updateJob && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    updateJob.status === 'done' ? 'bg-green-900 text-green-300' :
                    updateJob.status === 'error' ? 'bg-red-900 text-red-300' :
                    'bg-blue-900 text-blue-300 animate-pulse'
                  }`}>{updateJob.status}</span>
                  {updateJob.error && <span className="text-xs text-red-400">{updateJob.error}</span>}
                </div>
                {updateJob.log && (
                  <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-auto max-h-48">{updateJob.log}</pre>
                )}
              </div>
            )}
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
