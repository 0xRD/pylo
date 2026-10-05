import { useEffect, useState } from 'react'
import { backupApi } from '../api/exportImport'
import { getGitConfig, updateGitConfig } from '../api/gitops'
import { useAuth } from '../context/AuthContext'
import { useGitops } from '../context/GitopsContext'

const settingsApi = {
  get: () => fetch('/api/settings', { credentials: 'include' }).then(r => r.json()),
  update: (data) => fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  testNotification: () => fetch('/api/settings/notifications/test', {
    method: 'POST', credentials: 'include',
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Test failed')
    return r.json()
  }),
}

const apiKeysApi = {
  list: () => fetch('/api/api-keys', { credentials: 'include' }).then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load API keys'))),
  create: (data) => fetch('/api/api-keys', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(async r => r.ok ? r.json() : Promise.reject(new Error((await r.text()) || 'Could not create API key'))),
  revoke: (id) => fetch(`/api/api-keys/${id}`, { method: 'DELETE', credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error('Could not revoke API key')
  }),
}

const API_KEY_SCOPES = ['blueprints:read', 'entries:read', 'entries:write', 'pybooks:trigger', 'runs:read']

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return iso }
}

export default function Settings() {
  const { isAdmin } = useAuth()
  const { refetch: refetchGitops } = useGitops()
  const [settings, setSettings] = useState(null)
  const [maxConcurrent, setMaxConcurrent] = useState(5)
  const [jwtHours, setJwtHours] = useState(24)
  const [activityRetention, setActivityRetention] = useState(7)
  const [runRetention, setRunRetention] = useState(30)
  const [notifyUrl, setNotifyUrl] = useState('')
  const [notifyStatus, setNotifyStatus] = useState({ busy: false, message: '', error: false })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // ── Backup download state ────────────────────────────────────────────────────
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [secretsPassphrase, setSecretsPassphrase] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [backupError, setBackupError] = useState('')

  // ── Restore state ────────────────────────────────────────────────────────────
  const [backupFile, setBackupFile] = useState(null)
  const [restoreConfirm, setRestoreConfirm] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoreError, setRestoreError] = useState('')

  // ── Auto-backup state ────────────────────────────────────────────────────────
  const [backupCron, setBackupCron] = useState('')
  const [backupRetention, setBackupRetention] = useState(7)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleSaved, setScheduleSaved] = useState(false)
  const [scheduleError, setScheduleError] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [runNowBusy, setRunNowBusy] = useState(false)
  const [runNowMessage, setRunNowMessage] = useState('')

  // ── API key state ────────────────────────────────────────────────────────────
  const [apiKeys, setApiKeys] = useState([])
  const [apiKeyName, setApiKeyName] = useState('')
  const [apiKeyScopes, setApiKeyScopes] = useState(['blueprints:read', 'entries:read'])
  const [createdApiKey, setCreatedApiKey] = useState('')
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')

  // ── GitOps state ─────────────────────────────────────────────────────────────
  const [gitEnv, setGitEnv] = useState('dev')
  const [gitRepoUrl, setGitRepoUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitToken, setGitToken] = useState('')
  const [gitTokenSet, setGitTokenSet] = useState(false)
  const [gitCommitterName, setGitCommitterName] = useState('Pylo')
  const [gitCommitterEmail, setGitCommitterEmail] = useState('pylo@localhost')
  const [gitSaving, setGitSaving] = useState(false)
  const [gitSaved, setGitSaved] = useState(false)
  const [gitError, setGitError] = useState('')

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const h = await backupApi.getHistory()
      setHistory(h)
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }

  const loadApiKeys = async () => {
    try {
      const keys = await apiKeysApi.list()
      setApiKeys(keys)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    settingsApi.get().then(s => {
      setSettings(s)
      setMaxConcurrent(s.max_concurrent_runs)
      setJwtHours(s.jwt_expire_hours ?? 24)
      setActivityRetention(s.activity_retention_days ?? 7)
      setRunRetention(s.run_retention_days ?? 30)
      setNotifyUrl(s.notify_webhook_url ?? '')
      setBackupCron(s.backup_cron ?? '')
      setBackupRetention(s.backup_retention ?? 7)
    }).catch(() => {})
    if (isAdmin) loadHistory()
    if (isAdmin) loadApiKeys()
    if (isAdmin) {
      getGitConfig().then(gc => {
        setGitEnv(gc.environment ?? 'dev')
        setGitRepoUrl(gc.git_repo_url ?? '')
        setGitBranch(gc.git_branch ?? 'main')
        setGitTokenSet(gc.git_token_set ?? false)
        setGitCommitterName(gc.git_committer_name ?? 'Pylo')
        setGitCommitterEmail(gc.git_committer_email ?? 'pylo@localhost')
      }).catch(() => {})
    }
  }, [])

  const isDirty = maxConcurrent !== settings?.max_concurrent_runs
    || jwtHours !== (settings?.jwt_expire_hours ?? 24)
    || activityRetention !== (settings?.activity_retention_days ?? 7)
    || runRetention !== (settings?.run_retention_days ?? 30)

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      const updated = await settingsApi.update({
        max_concurrent_runs: maxConcurrent,
        jwt_expire_hours: jwtHours,
        activity_retention_days: activityRetention,
        run_retention_days: runRetention,
      })
      setSettings(s => ({
        ...s,
        ...(updated.max_concurrent_runs !== undefined && { max_concurrent_runs: updated.max_concurrent_runs }),
        ...(updated.jwt_expire_hours !== undefined && { jwt_expire_hours: updated.jwt_expire_hours }),
        ...(updated.activity_retention_days !== undefined && { activity_retention_days: updated.activity_retention_days }),
        ...(updated.run_retention_days !== undefined && { run_retention_days: updated.run_retention_days }),
      }))
      if (updated.activity_retention_days !== undefined) setActivityRetention(updated.activity_retention_days)
      if (updated.run_retention_days !== undefined) setRunRetention(updated.run_retention_days)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const handleSaveNotify = async () => {
    setNotifyStatus({ busy: true, message: '', error: false })
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notify_webhook_url: notifyUrl }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || 'Could not save webhook')
      setSettings(s => ({ ...s, notify_webhook_url: data.notify_webhook_url }))
      setNotifyStatus({ busy: false, message: data.notify_webhook_url ? 'Saved' : 'Notifications disabled', error: false })
    } catch (e) {
      setNotifyStatus({ busy: false, message: e.message, error: true })
    }
  }

  const handleTestNotify = async () => {
    setNotifyStatus({ busy: true, message: '', error: false })
    try {
      await settingsApi.testNotification()
      setNotifyStatus({ busy: false, message: 'Test notification delivered', error: false })
    } catch (e) {
      setNotifyStatus({ busy: false, message: e.message, error: true })
    }
  }

  const handleSaveGitConfig = async () => {
    setGitSaving(true); setGitError(''); setGitSaved(false)
    try {
      await updateGitConfig({
        environment: gitEnv,
        git_repo_url: gitRepoUrl,
        git_branch: gitBranch || 'main',
        git_token: gitToken || null,
        git_committer_name: gitCommitterName,
        git_committer_email: gitCommitterEmail,
      })
      if (gitToken) { setGitTokenSet(true); setGitToken('') }
      setGitSaved(true)
      setTimeout(() => setGitSaved(false), 2000)
      await refetchGitops()
    } catch (e) {
      setGitError(e.message)
    } finally { setGitSaving(false) }
  }

  const handleDownloadBackup = async () => {
    setBackupBusy(true); setBackupError(''); setBackupMessage('')
    try {
      if (includeSecrets) {
        if (!secretsPassphrase || secretsPassphrase.length < 8) {
          setBackupError('Passphrase must be at least 8 characters.')
          return
        }
        await backupApi.downloadFullWithSecrets(secretsPassphrase)
        setBackupMessage('Backup downloaded with encrypted secrets.')
      } else {
        await backupApi.downloadFull()
        setBackupMessage('Backup downloaded. Secret values are excluded.')
      }
    } catch (e) {
      setBackupError(e.message)
    } finally { setBackupBusy(false) }
  }

  const handleImportBackup = async () => {
    if (!backupFile) return
    setRestoreBusy(true); setRestoreError(''); setRestoreMessage('')
    try {
      const result = await backupApi.importFull(backupFile, restoreConfirm, restorePassphrase)
      const imported = result.imported || {}
      const parts = [
        `${imported.blueprints ?? 0} blueprints`,
        `${imported.pybooks ?? 0} PyBooks`,
        `${imported.workflows ?? 0} workflows`,
      ]
      if ((imported.secrets ?? 0) > 0) parts.push(`${imported.secrets} secrets`)
      setRestoreMessage(`Imported: ${parts.join(', ')}.`)
      setBackupFile(null)
      setRestoreConfirm('')
      setRestorePassphrase('')
    } catch (e) {
      setRestoreError(e.message)
    } finally { setRestoreBusy(false) }
  }

  const handleSaveSchedule = async () => {
    setScheduleSaving(true); setScheduleError(''); setScheduleSaved(false)
    try {
      await settingsApi.update({ backup_cron: backupCron, backup_retention: backupRetention })
      setScheduleSaved(true)
      setTimeout(() => setScheduleSaved(false), 2000)
    } catch (e) {
      setScheduleError(e.message)
    } finally { setScheduleSaving(false) }
  }

  const handleRunNow = async () => {
    setRunNowBusy(true); setRunNowMessage('')
    try {
      const r = await backupApi.runNow()
      setRunNowMessage(`Saved: ${r.filename}`)
      await loadHistory()
    } catch (e) {
      setRunNowMessage(`Error: ${e.message}`)
    } finally { setRunNowBusy(false) }
  }

  const handleDeleteSaved = async (filename) => {
    if (!confirm(`Delete backup "${filename}"?`)) return
    try {
      await backupApi.deleteSaved(filename)
      setHistory(h => h.filter(f => f.filename !== filename))
    } catch (e) {
      alert(`Delete failed: ${e.message}`)
    }
  }

  const handleDownloadSaved = async (filename) => {
    try {
      await backupApi.downloadSaved(filename)
    } catch (e) {
      alert(`Download failed: ${e.message}`)
    }
  }

  const toggleApiKeyScope = (scope) => {
    setApiKeyScopes(scopes => scopes.includes(scope) ? scopes.filter(s => s !== scope) : [...scopes, scope])
  }

  const handleCreateApiKey = async () => {
    setApiKeyBusy(true); setApiKeyError(''); setCreatedApiKey('')
    try {
      const created = await apiKeysApi.create({ name: apiKeyName, scopes: apiKeyScopes })
      setCreatedApiKey(created.token)
      setApiKeyName('')
      setApiKeyScopes(['blueprints:read', 'entries:read'])
      await loadApiKeys()
    } catch (e) {
      setApiKeyError(e.message)
    } finally { setApiKeyBusy(false) }
  }

  const handleRevokeApiKey = async (id) => {
    if (!confirm('Revoke this API key?')) return
    try {
      await apiKeysApi.revoke(id)
      await loadApiKeys()
    } catch (e) {
      setApiKeyError(e.message)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-100 mb-6">Settings</h1>

      <section className="space-y-6">

        {/* ── PyBook execution ──────────────────────────────────────────────── */}
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

        {/* ── Security ──────────────────────────────────────────────────────── */}
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

        {/* ── Data retention ────────────────────────────────────────────────── */}
        <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-200 mb-1">Data retention</h2>
          <p className="text-xs text-gray-500 mb-4">Old records are pruned nightly. Queued or running runs are never deleted.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-gray-400">Activity log (days)</span>
              <input
                type="number" min={1} max={365} value={activityRetention}
                onChange={e => setActivityRetention(Number(e.target.value))}
                disabled={!isAdmin}
                className="mt-1 w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Finished runs (days, 0 = keep forever)</span>
              <input
                type="number" min={0} max={3650} value={runRetention}
                onChange={e => setRunRetention(Number(e.target.value))}
                disabled={!isAdmin}
                className="mt-1 w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </label>
          </div>
        </div>



        {/* ── Notifications ─────────────────────────────────────────────────── */}
        {isAdmin && (
          <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Failure notifications</h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Pylo POSTs a JSON message to this URL when a PyBook or Workflow run ends in error, timeout, or dead-letter
                (after retries). The payload includes a Slack/Mattermost-compatible <code>text</code> field. Leave empty to disable.
              </p>
            </div>
            <input
              value={notifyUrl}
              onChange={e => setNotifyUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
            />
            <div className="flex items-center gap-2">
              <button onClick={handleSaveNotify} disabled={notifyStatus.busy || notifyUrl === (settings?.notify_webhook_url ?? '')}
                className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded">
                Save
              </button>
              <button onClick={handleTestNotify} disabled={notifyStatus.busy || !settings?.notify_webhook_url}
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 rounded">
                Send test
              </button>
              {notifyStatus.message && (
                <span className={`text-xs ${notifyStatus.error ? 'text-red-400' : 'text-green-400'}`}>{notifyStatus.message}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Scoped API keys ───────────────────────────────────────────────── */}
        {isAdmin && (
          <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Scoped API keys</h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Create least-privilege tokens for scripts and SIEM integrations. The raw token is shown once.
              </p>
            </div>

            <div className="space-y-3">
              <input
                value={apiKeyName}
                onChange={e => setApiKeyName(e.target.value)}
                placeholder="Integration name"
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {API_KEY_SCOPES.map(scope => (
                  <label key={scope} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={apiKeyScopes.includes(scope)}
                      onChange={() => toggleApiKeyScope(scope)}
                      className="accent-indigo-500"
                    />
                    <span className="font-mono">{scope}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={handleCreateApiKey}
                disabled={apiKeyBusy || !apiKeyName.trim() || apiKeyScopes.length === 0}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs font-medium transition-colors">
                {apiKeyBusy ? 'Creating…' : 'Create API key'}
              </button>
              {createdApiKey && (
                <div className="bg-green-950/40 border border-green-900 rounded px-3 py-2">
                  <p className="text-xs text-green-300 mb-1">Copy this token now. It will not be shown again.</p>
                  <code className="block break-all text-xs text-green-100 font-mono">{createdApiKey}</code>
                </div>
              )}
              {apiKeyError && <p className="text-xs text-red-400 bg-red-950/50 border border-red-900 rounded px-3 py-2">{apiKeyError}</p>}
            </div>

            <div className="border-t border-gray-800 pt-4 space-y-2">
              {apiKeys.length === 0 ? (
                <p className="text-xs text-gray-600">No scoped API keys yet.</p>
              ) : apiKeys.map(key => (
                <div key={key.id} className="flex items-center gap-3 bg-gray-950 border border-gray-800 rounded px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-200 truncate">{key.name}</span>
                      {!key.is_active && <span className="text-[10px] text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded">revoked</span>}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-1">
                      {key.scopes.join(', ')} · last used {key.last_used_at ? fmtDate(key.last_used_at) : 'never'}
                    </div>
                  </div>
                  {key.is_active && (
                    <button
                      onClick={() => handleRevokeApiKey(key.id)}
                      className="text-xs text-gray-600 hover:text-red-400 shrink-0 transition-colors">
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* ── Backup & restore ──────────────────────────────────────────────── */}
        {isAdmin && (
          <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg space-y-5">
            <h2 className="text-sm font-semibold text-gray-200">Backup and restore</h2>

            {/* Download section */}
            <div className="space-y-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                Download a ZIP snapshot of blueprints, PyBooks, workflows, and settings.
                Optionally include secret values encrypted with a passphrase.
              </p>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSecrets}
                  onChange={e => setIncludeSecrets(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span className="text-xs text-gray-300">Include secrets (encrypted with passphrase)</span>
              </label>

              {includeSecrets && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Encryption passphrase (min. 8 chars)</label>
                  <input
                    type="password"
                    value={secretsPassphrase}
                    onChange={e => setSecretsPassphrase(e.target.value)}
                    placeholder="Enter a strong passphrase…"
                    disabled={backupBusy}
                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                </div>
              )}

              <button
                onClick={handleDownloadBackup}
                disabled={backupBusy || (includeSecrets && secretsPassphrase.length < 8)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs font-medium transition-colors">
                {backupBusy ? 'Working…' : 'Download backup'}
              </button>

              {backupMessage && <p className="text-xs text-green-400">{backupMessage}</p>}
              {backupError && <p className="text-xs text-red-400 bg-red-950/50 border border-red-900 rounded px-3 py-2">{backupError}</p>}
            </div>

            {/* Restore section */}
            <div className="border-t border-gray-800 pt-4 space-y-3">
              <p className="text-xs text-gray-500">Import a backup ZIP to restore all objects. Existing objects will be overwritten by name.</p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Import backup ZIP</label>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={restoreBusy}
                  onChange={e => setBackupFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs file:text-gray-200 hover:file:bg-gray-700 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Passphrase{' '}
                  <span className="text-gray-600">(only if backup contains encrypted secrets)</span>
                </label>
                <input
                  type="password"
                  value={restorePassphrase}
                  onChange={e => setRestorePassphrase(e.target.value)}
                  placeholder="Leave empty if secrets are not included"
                  disabled={restoreBusy}
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Type RESTORE to confirm</label>
                <input
                  value={restoreConfirm}
                  onChange={e => setRestoreConfirm(e.target.value)}
                  disabled={restoreBusy}
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              </div>
              <button
                onClick={handleImportBackup}
                disabled={restoreBusy || !backupFile || restoreConfirm !== 'RESTORE'}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs font-medium transition-colors">
                Import backup
              </button>
              {restoreMessage && <p className="text-xs text-green-400">{restoreMessage}</p>}
              {restoreError && <p className="text-xs text-red-400 bg-red-950/50 border border-red-900 rounded px-3 py-2">{restoreError}</p>}
            </div>
          </div>
        )}

        {/* ── Auto-backup ───────────────────────────────────────────────────── */}
        {isAdmin && (
          <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Scheduled auto-backup</h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Automatically save backups to disk on a schedule. Secrets are never included in auto-backups.
                Files are stored in <code className="text-gray-400 bg-gray-800 px-1 py-0.5 rounded text-[10px]">objects_storage/backups/</code>.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Cron schedule{' '}
                  <span className="text-gray-600">(5-field, e.g. <code className="font-mono">0 2 * * *</code> for daily at 2 am — leave empty to disable)</span>
                </label>
                <input
                  type="text"
                  value={backupCron}
                  onChange={e => setBackupCron(e.target.value)}
                  placeholder="0 2 * * *"
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Keep last{' '}
                  <span className="font-mono text-indigo-300">{backupRetention}</span>{' '}
                  backup{backupRetention !== 1 ? 's' : ''}
                </label>
                <input
                  type="range" min={1} max={30} value={backupRetention}
                  onChange={e => setBackupRetention(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>1</span><span>30</span>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleSaveSchedule}
                  disabled={scheduleSaving}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs font-medium transition-colors">
                  {scheduleSaving ? 'Saving…' : 'Save schedule'}
                </button>
                <button
                  onClick={handleRunNow}
                  disabled={runNowBusy}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs font-medium transition-colors">
                  {runNowBusy ? 'Running…' : 'Backup now'}
                </button>
                {scheduleSaved && <span className="text-xs text-green-400">Schedule saved</span>}
                {scheduleError && <span className="text-xs text-red-400">{scheduleError}</span>}
                {runNowMessage && <span className="text-xs text-green-400">{runNowMessage}</span>}
              </div>
            </div>

            {/* Backup history */}
            <div className="border-t border-gray-800 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-medium">Saved backups</span>
                <button onClick={loadHistory} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Refresh</button>
              </div>

              {historyLoading ? (
                <p className="text-xs text-gray-600">Loading…</p>
              ) : history.length === 0 ? (
                <p className="text-xs text-gray-600">No saved backups yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {history.map(f => (
                    <div key={f.filename} className="flex items-center gap-3 bg-gray-950 border border-gray-800 rounded px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-gray-300 truncate">{f.filename}</div>
                        <div className="text-[10px] text-gray-600 mt-0.5">{fmtDate(f.created_at)} · {fmtBytes(f.size)}</div>
                      </div>
                      <button
                        onClick={() => handleDownloadSaved(f.filename)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 transition-colors">
                        Download
                      </button>
                      <button
                        onClick={() => handleDeleteSaved(f.filename)}
                        className="text-xs text-gray-600 hover:text-red-400 shrink-0 transition-colors">
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── GitOps configuration ──────────────────────────────────────────── */}
        {isAdmin && (
          <div className="p-5 bg-gray-900 border border-gray-800 rounded-lg space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Git configuration (GitOps)</h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Connect to a shared git repository to promote config objects between dev and prod instances.
                In dev mode a <strong className="text-gray-300">Commit</strong> button appears in the sidebar;
                in prod mode a <strong className="text-gray-300">Sync</strong> button shows remote changes.
              </p>
            </div>

            {/* Environment toggle */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">Environment</label>
              <div className="flex gap-3">
                {['dev', 'prod'].map(e => (
                  <label key={e} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="git_env"
                      value={e}
                      checked={gitEnv === e}
                      onChange={() => setGitEnv(e)}
                      className="accent-indigo-500"
                    />
                    <span className="text-sm text-gray-200 capitalize">{e}</span>
                    {e === 'prod' && <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">read-only config</span>}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Repository URL</label>
              <input
                type="text"
                value={gitRepoUrl}
                onChange={e => setGitRepoUrl(e.target.value)}
                placeholder="https://github.com/org/pylo-config"
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Branch</label>
                <input
                  type="text"
                  value={gitBranch}
                  onChange={e => setGitBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Access token{' '}
                  {gitTokenSet && !gitToken && (
                    <span className="text-green-500">● set</span>
                  )}
                </label>
                <input
                  type="password"
                  value={gitToken}
                  onChange={e => setGitToken(e.target.value)}
                  placeholder={gitTokenSet ? 'Leave blank to keep current' : 'GitHub / GitLab token…'}
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Committer name</label>
                <input
                  type="text"
                  value={gitCommitterName}
                  onChange={e => setGitCommitterName(e.target.value)}
                  placeholder="Pylo"
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Committer email</label>
                <input
                  type="email"
                  value={gitCommitterEmail}
                  onChange={e => setGitCommitterEmail(e.target.value)}
                  placeholder="pylo@localhost"
                  className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveGitConfig}
                disabled={gitSaving}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs font-medium transition-colors"
              >
                {gitSaving ? 'Saving…' : 'Save git config'}
              </button>
              {gitSaved && <span className="text-xs text-green-400">Saved</span>}
              {gitError && <span className="text-xs text-red-400">{gitError}</span>}
            </div>
          </div>
        )}

        {/* ── Config note ───────────────────────────────────────────────────── */}
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
