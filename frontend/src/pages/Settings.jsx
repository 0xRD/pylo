import { useEffect, useState } from 'react'
import { runsApi } from '../api/pybooks'

const settingsApi = {
  get: () => fetch('/api/settings', { headers: { 'X-API-Token': import.meta.env.VITE_API_TOKEN || 'change_me_in_production' } }).then(r => r.json()),
  update: (data) => fetch('/api/settings', {
    method: 'PUT',
    headers: { 'X-API-Token': import.meta.env.VITE_API_TOKEN || 'change_me_in_production', 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [maxConcurrent, setMaxConcurrent] = useState(5)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    settingsApi.get().then(s => {
      setSettings(s)
      setMaxConcurrent(s.max_concurrent_runs)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      const updated = await settingsApi.update({ max_concurrent_runs: maxConcurrent })
      setSettings(s => ({ ...s, max_concurrent_runs: updated.max_concurrent_runs }))
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
                className="w-full accent-indigo-500"
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

            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} disabled={saving || maxConcurrent === settings?.max_concurrent_runs}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
                {saving ? 'Saving…' : 'Apply'}
              </button>
              {saved && <span className="text-xs text-green-400">Saved — takes effect immediately</span>}
              {maxConcurrent !== settings?.max_concurrent_runs && !saved && (
                <span className="text-xs text-gray-500">Unsaved changes</span>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-200 mb-1">Configuration note</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            The default value of max concurrent runs can also be set via the{' '}
            <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded">PYLO_MAX_CONCURRENT_RUNS</code>{' '}
            environment variable. Changes made here are persisted in the database and override the environment variable.
          </p>
        </div>
      </section>
    </div>
  )
}
