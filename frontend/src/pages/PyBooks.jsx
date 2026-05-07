import { useEffect, useRef, useState } from "react"
import CodeEditor from "../components/CodeEditor"
import RunStatusBadge from "../components/RunStatusBadge"
import { pybooksApi } from "../api/pybooks"
import { secretsApi } from "../api/secrets"
import { blueprintsApi } from "../api/blueprints"
import ScheduleBuilder from "../components/ScheduleBuilder"
import { useAuth } from "../context/AuthContext"
import { useGitops } from "../context/GitopsContext"
import { fmtDateTime } from "../utils/dates"
import { exportApi, importApi, readImportFile } from "../api/exportImport"
import ImportConflictModal from "../components/ImportConflictModal"
import {
  BookOpen,
  Braces,
  CheckCircle2,
  ClipboardList,
  Code2,
  Copy,
  FileText,
  HelpCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  X,
  Zap,
} from "lucide-react"

const DEFAULT_SCRIPT = `# Your PyBook script
# Available: requests, httpx, pydantic (always)
# Access secrets via os.environ["SECRET_your_key"]
# Read input payload via pylo.get_payload()
# Call sub-PyBooks via pylo_sdk (auto-mounted at /pybook/pylo_sdk.py)

import pylo_sdk as pylo

payload = pylo.get_payload()
print("Hello from Pylo!", payload)
`

const TRIGGER_TYPES = ["manual", "cron", "webhook", "blueprint"]
const TERMINAL = new Set(["success", "error", "timeout"])

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function RequiredSecretsSelect({ value, onChange, secrets = [], disabled = false }) {
  const selected = parseJsonArray(value)
  const selectedSet = new Set(selected)
  const toggle = (name) => {
    if (disabled) return
    const next = selectedSet.has(name)
      ? selected.filter(item => item !== name)
      : [...selected, name]
    onChange(JSON.stringify(next))
  }

  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">
        Required API keys / secrets <span className="text-gray-600">(stored secrets)</span>
      </label>
      <div className="min-h-10 rounded border border-gray-700 bg-gray-800 p-2">
        {secrets.length === 0 ? (
          <p className="text-xs text-gray-600">No stored secrets yet. Add API keys in Secrets first.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {secrets.map(secret => {
              const active = selectedSet.has(secret.name)
              return (
                <button
                  key={secret.id}
                  type="button"
                  onClick={() => toggle(secret.name)}
                  disabled={disabled}
                  title={active ? `Remove ${secret.name}` : `Inject ${secret.name}`}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-indigo-500 bg-indigo-950/70 text-indigo-200' : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-gray-200'}`}
                >
                  <span className="truncate">{secret.name}</span>
                  {active && <X className="h-3 w-3 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-1">Click a selected key again, or its ×, to remove it. Selected values are injected as SECRET_&lt;name&gt;.</p>
    </div>
  )
}

function InlineHelp({ text }) {
  return (
    <span className="group relative inline-flex align-middle">
      <HelpCircle className="h-3.5 w-3.5 text-gray-500" />
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded border border-gray-700 bg-gray-950 p-2 text-xs leading-relaxed text-gray-300 shadow-xl group-hover:block">
        {text}
      </span>
    </span>
  )
}

const TRIGGER_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'regex', label: 'matches regex' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
]

function TriggerConditionBuilder({ value, onChange }) {
  const conditions = (() => { try { return JSON.parse(value || '[]') } catch { return [] } })()
  const update = next => onChange(JSON.stringify(next))
  const add = () => update([...conditions, { field: '', operator: 'eq', value: '' }])
  const remove = i => update(conditions.filter((_, idx) => idx !== i))
  const setC = (i, k, v) => update(conditions.map((c, idx) => idx === i ? { ...c, [k]: v } : c))
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Only trigger when entry matches:</span>
        <button type="button" onClick={add} className="text-xs text-indigo-400 hover:text-indigo-200">+ Add condition</button>
      </div>
      {conditions.length === 0 && <p className="text-xs text-gray-600 italic">No conditions — fires for every new entry.</p>}
      {conditions.map((cond, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={cond.field} onChange={e => setC(i, 'field', e.target.value)} placeholder="field"
            className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-indigo-500" />
          <select value={cond.operator} onChange={e => setC(i, 'operator', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500">
            {TRIGGER_OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
          </select>
          <input value={cond.value} onChange={e => setC(i, 'value', e.target.value)} placeholder="value"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-indigo-500" />
          <button type="button" onClick={() => remove(i)} className="text-gray-600 hover:text-red-400 text-sm shrink-0">×</button>
        </div>
      ))}
    </div>
  )
}

function BlueprintTriggerConfig({ triggerConfig, onChange, blueprints }) {
  const cfg = (() => { try { return JSON.parse(triggerConfig || '{}') } catch { return {} } })()
  const set = (k, v) => onChange(JSON.stringify({ ...cfg, [k]: v }))
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-40">
          <label className="block text-xs text-gray-400 mb-1">Blueprint</label>
          <select value={cfg.blueprint_id || ''} onChange={e => set('blueprint_id', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500">
            <option value="">— select blueprint —</option>
            {blueprints.map(bp => <option key={bp.id} value={bp.id}>{bp.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Event</label>
          <select value={cfg.trigger_event || 'on_create'} onChange={e => set('trigger_event', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500">
            <option value="on_create">On new entry</option>
            <option value="on_create_or_update">On new or updated entry</option>
          </select>
        </div>
      </div>
      {cfg.blueprint_id && (
        <div className="border-t border-gray-800 pt-3">
          <TriggerConditionBuilder
            value={JSON.stringify(cfg.trigger_conditions || [])}
            onChange={v => { try { set('trigger_conditions', JSON.parse(v)) } catch {} }}
          />
        </div>
      )}
    </div>
  )
}

// ── Tag chip helpers ──────────────────────────────────────────────────────────

function TagChip({ tag, onRemove, onClick, active }) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors cursor-pointer select-none ${
        active
          ? 'bg-[#bd93f9] text-[#191a21]'
          : 'bg-[#343746] text-[#c9ccd6] hover:bg-[#44475a]'
      }`}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onRemove(tag) }}
          className="hover:text-[#ff79c6] leading-none"
        >×</button>
      )}
    </span>
  )
}

function TagInput({ tags, onChange }) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const t = draft.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && draft === '' && tags.length > 0)
      onChange(tags.slice(0, -1))
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center bg-[#191a21] border border-[#343746] rounded px-2 py-1.5 min-h-9 focus-within:border-[#8be9fd] transition-colors">
      {tags.map(t => (
        <TagChip key={t} tag={t} onRemove={tag => onChange(tags.filter(x => x !== tag))} />
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={add}
        placeholder={tags.length === 0 ? 'Add tags… (press Enter)' : ''}
        className="bg-transparent outline-none text-xs text-[#f8f8f2] placeholder-[#6272a4] flex-1 min-w-20"
      />
    </div>
  )
}

// ── New PyBook form ───────────────────────────────────────────────────────────

function NewPyBookForm({ onSave, onCancel, blueprints = [], secrets = [] }) {
  const [form, setForm] = useState({
    name: "", description: "", script: DEFAULT_SCRIPT,
    is_sub_pybook: false, dependencies: "[]",
    trigger_type: "manual", trigger_config: '{"cron": "0 * * * *"}', required_secrets: "[]",
    tags: "[]",
  })
  const [tags, setTags] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try { await onSave({ ...form, tags: JSON.stringify(tags) }) }
    catch (err) { setError(err.message); setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      {error && <p className="text-red-400 text-sm bg-red-950 px-3 py-2 rounded">{error}</p>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)} required
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Trigger type</label>
          <select value={form.trigger_type} onChange={e => set("trigger_type", e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
            {TRIGGER_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {form.trigger_type === "cron" && (
        <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-2">
          <label className="block text-xs text-gray-400 font-medium">Schedule</label>
          <ScheduleBuilder
            value={(() => { try { return JSON.parse(form.trigger_config).cron || "" } catch { return "" } })()}
            onChange={cron => set("trigger_config", JSON.stringify({ cron }))}
          />
        </div>
      )}
      {form.trigger_type === "blueprint" && (
        <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-3">
          <label className="block text-xs text-gray-400 font-medium">Blueprint subscription</label>
          <BlueprintTriggerConfig
            triggerConfig={form.trigger_config}
            onChange={v => set("trigger_config", v)}
            blueprints={blueprints}
          />
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description</label>
        <input value={form.description} onChange={e => set("description", e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Tags</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Dependencies (JSON array)</label>
          <input value={form.dependencies} onChange={e => set("dependencies", e.target.value)}
            placeholder='["pandas", "boto3"]'
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <RequiredSecretsSelect
            value={form.required_secrets}
            onChange={value => set("required_secrets", value)}
            secrets={secrets}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="is_sub" checked={form.is_sub_pybook}
          onChange={e => set("is_sub_pybook", e.target.checked)} className="rounded border-gray-600" />
        <label htmlFor="is_sub" className="text-sm text-gray-300">Sub-PyBook (callable by other PyBooks)</label>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Initial script</label>
        <div className="border border-gray-700 rounded overflow-hidden">
          <CodeEditor value={form.script} onChange={v => set("script", v || "")} height="300px" />
        </div>
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
          {saving ? "Creating..." : "Create PyBook"}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">Cancel</button>
      </div>
    </form>
  )
}

// ── Run panel ─────────────────────────────────────────────────────────────────

function parseRunVars(run) {
  try { return Object.entries(JSON.parse(run?.output_vars || '{}')) }
  catch { return [] }
}

function formatJson(value) {
  try { return JSON.stringify(typeof value === "string" ? JSON.parse(value) : value, null, 2) }
  catch { return String(value || "") }
}

const PAYLOAD_TEMPLATES = [
  { label: 'Empty', value: {} },
  { label: 'Selected Entry', value: { blueprint_id: 'blueprint-uuid', entry_id: 'entry-uuid', entry_data: { hash: 'abc123', severity: 'high' } } },
  { label: 'Webhook', value: { event_type: 'alert.created', source: 'webhook', data: { id: 'alert-1' } } },
  { label: 'Workflow input', value: { alert_id: 'alert-1', ioc: '1.2.3.4', verdict: 'suspicious' } },
]

const PAYLOAD_SNIPPET = `import pylo_sdk as pylo

payload = pylo.get_payload()
entry_id = payload.get("entry_id")
entry_data = payload.get("entry_data", {})`

function RunPanel({ pybook, onClose, isAdmin }) {
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const [running, setRunning] = useState(false)
  const [payloadText, setPayloadText] = useState("{}")
  const [payloadError, setPayloadError] = useState("")
  const wsRef = useRef(null)
  const pollRef = useRef(null)

  const loadRuns = () => pybooksApi.getRuns(pybook.id).then(data => {
    setRuns(data)
    setSelectedRun(current => current || data[0] || null)
  }).catch(console.error)

  useEffect(() => {
    setSelectedRun(null)
    loadRuns()
    pollRef.current = setInterval(loadRuns, 3000)
    return () => { clearInterval(pollRef.current); wsRef.current?.close() }
  }, [pybook.id])

  useEffect(() => {
    if (selectedRun) {
      const updated = runs.find(r => r.id === selectedRun.id)
      if (updated && updated.status !== selectedRun.status) setSelectedRun(updated)
    }
  }, [runs])

  const connectWs = (runId) => {
    wsRef.current?.close()
    const proto = window.location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${proto}://${window.location.host}/api/runs/${runId}/ws`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (!data.error) setSelectedRun(data)
      if (TERMINAL.has(data.status)) { loadRuns(); ws.close() }
    }
    ws.onerror = () => {}
  }

  const handleRun = async (payload = {}) => {
    setRunning(true)
    setPayloadError("")
    try {
      const run = await pybooksApi.run(pybook.id, payload)
      setSelectedRun(run); connectWs(run.id); loadRuns()
    } catch (err) {
      setPayloadError(err.message)
    } finally { setRunning(false) }
  }

  const handleRunWithPayload = async () => {
    try {
      await handleRun(JSON.parse(payloadText || "{}"))
    } catch (err) {
      setPayloadError(err.message)
    }
  }

  const reuseSelectedPayload = () => {
    if (!selectedRun?.trigger_payload) return
    try { setPayloadText(JSON.stringify(JSON.parse(selectedRun.trigger_payload), null, 2)) }
    catch { setPayloadText(selectedRun.trigger_payload) }
  }

  const applyTemplate = (value) => setPayloadText(JSON.stringify(value, null, 2))
  const vars = selectedRun ? parseRunVars(selectedRun) : []

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[#343746] bg-[#191a21]/95">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#343746] px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold text-[#f8f8f2]">
            <TerminalIcon />
            <span>Run console</span>
          </div>
          <p className="text-xs text-[#6272a4] truncate">{pybook.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleRun()} disabled={running || !isAdmin}
            className="inline-flex items-center gap-1.5 rounded bg-[#50fa7b] px-3 py-2 text-xs font-semibold text-[#191a21] transition-colors hover:bg-[#69ff94] disabled:cursor-not-allowed disabled:opacity-50">
            <Play className="h-3.5 w-3.5" />
            {running ? "Starting..." : "Run empty"}
          </button>
          <button onClick={handleRunWithPayload} disabled={running || !isAdmin}
            className="inline-flex items-center gap-1.5 rounded bg-[#8be9fd] px-3 py-2 text-xs font-semibold text-[#191a21] transition-colors hover:bg-[#a4f1ff] disabled:cursor-not-allowed disabled:opacity-50">
            <Braces className="h-3.5 w-3.5" />
            Run payload
          </button>
          <button onClick={onClose} className="rounded p-2 text-[#6272a4] hover:bg-[#282a36] hover:text-[#f8f8f2]" title="Close runs">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded border border-[#343746] bg-[#20222c]">
          <div className="shrink-0 border-b border-[#343746] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6272a4]">Recent runs</div>
          {runs.length === 0 ? (
            <p className="p-4 text-xs italic text-[#6272a4]">No runs yet.</p>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {runs.map(run => (
                <button key={run.id}
                  onClick={() => { setSelectedRun(run); if (!TERMINAL.has(run.status)) connectWs(run.id) }}
                  className={"w-full rounded border px-3 py-2 text-left transition-colors " + (selectedRun?.id === run.id ? "border-[#bd93f9] bg-[#282a36]" : "border-[#343746] bg-[#191a21] hover:border-[#6272a4]")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <RunStatusBadge status={run.status} />
                    {run.duration_ms != null && <span className="text-[10px] text-[#6272a4]">{run.duration_ms}ms</span>}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-[#8b8fa3]">{fmtDateTime(run.started_at)}</p>
                  <p className="mt-1 truncate text-[10px] text-[#6272a4]">{run.trigger_source}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-[#343746] bg-[#191a21] p-4">
          {!selectedRun ? (
            <p className="text-xs italic text-[#6272a4]">Select a run to view logs.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#343746] bg-[#282a36] px-3 py-2">
                <div className="flex items-center gap-2">
                  <RunStatusBadge status={selectedRun.status} />
                  <span className="text-xs text-[#8b8fa3]">{selectedRun.trigger_source}</span>
                  {selectedRun.duration_ms != null && <span className="text-xs text-[#6272a4]">{selectedRun.duration_ms}ms</span>}
                </div>
                <span className="max-w-full truncate font-mono text-[11px] text-[#6272a4]">{selectedRun.id}</span>
              </div>

              {selectedRun.stdout && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#50fa7b]">stdout</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[#343746] bg-[#0f1117] p-3 font-mono text-xs text-[#50fa7b]">{selectedRun.stdout}</pre>
                </div>
              )}

              {selectedRun.stderr && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#ff5555]">stderr</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[#343746] bg-[#0f1117] p-3 font-mono text-xs text-[#ff5555]">{selectedRun.stderr}</pre>
                </div>
              )}

              {!selectedRun.stdout && !selectedRun.stderr && !TERMINAL.has(selectedRun.status) && (
                <p className="text-xs italic text-[#6272a4] animate-pulse">Running...</p>
              )}
              {!selectedRun.stdout && !selectedRun.stderr && TERMINAL.has(selectedRun.status) && (
                <p className="text-xs italic text-[#6272a4]">This run did not emit stdout or stderr.</p>
              )}

              <div>
                <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#8be9fd]">
                  <Braces className="h-3.5 w-3.5" />
                  Input payload
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[#343746] bg-[#0f1117] p-3 font-mono text-xs text-[#8be9fd]">{formatJson(selectedRun.trigger_payload || '{}')}</pre>
              </div>

              <div>
                <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#bd93f9]">
                  <Braces className="h-3.5 w-3.5" />
                  Output variables
                </p>
                {vars.length === 0 ? (
                  <div className="rounded border border-dashed border-[#343746] bg-[#20222c] p-4 text-xs text-[#6272a4]">
                    No output variables exported. Use pylo.set_output("key", value) to publish them.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {vars.map(([k, v]) => (
                      <div key={k} className="rounded border border-[#343746] bg-[#20222c] px-3 py-2">
                        <p className="font-mono text-xs text-[#bd93f9]">{k}</p>
                        <p className="mt-1 break-all font-mono text-xs text-[#f8f8f2]">{JSON.stringify(v)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-[#343746] bg-[#20222c] p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#8be9fd]">
              New input payload
              <span title="JSON input injected into the PyBook as TRIGGER_PAYLOAD. Recommended access: payload = pylo.get_payload(). Output variables are separate and are created with pylo.set_output()." className="grid h-4 w-4 cursor-help place-items-center rounded-full border border-[#6272a4] text-[10px] text-[#6272a4]">?</span>
            </label>
            <button onClick={reuseSelectedPayload} disabled={!selectedRun}
              className="inline-flex items-center justify-center gap-1.5 rounded bg-[#282a36] px-2 py-1 text-xs text-[#a7abc4] hover:bg-[#343746] disabled:opacity-40">
              <RotateCcw className="h-3.5 w-3.5" />
              Reuse
            </button>
          </div>
          <textarea
            value={payloadText}
            onChange={e => setPayloadText(e.target.value)}
            rows={4}
            className="min-h-24 w-full rounded border border-[#343746] bg-[#0f1117] px-3 py-2 font-mono text-xs text-[#f8f8f2] outline-none focus:border-[#8be9fd]"
            placeholder='{"blueprint_id":"...","entry_id":"...","entry_data":{}}'
          />
          {payloadError && <p className="mt-2 text-xs text-[#ff5555]">{payloadError}</p>}

          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-[#bd93f9]">Templates</p>
          <div className="grid grid-cols-2 gap-2">
            {PAYLOAD_TEMPLATES.map(template => (
              <button key={template.label} onClick={() => applyTemplate(template.value)}
                className="rounded border border-[#343746] bg-[#282a36] px-3 py-2 text-left text-xs text-[#f8f8f2] hover:border-[#8be9fd]">
                {template.label}
              </button>
            ))}
          </div>

          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-[#bd93f9]">Python</p>
          <CodeSnippet code={PAYLOAD_SNIPPET} />
        </section>
      </div>
    </div>
  )
}

function TerminalIcon() {
  return <Code2 className="h-4 w-4 text-[#8be9fd]" />
}


// ── SDK Reference Panel ───────────────────────────────────────────────────────

function CodeSnippet({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="relative group">
      <pre className="bg-gray-950 border border-gray-800 rounded p-2.5 text-xs font-mono text-green-300 whitespace-pre overflow-auto leading-relaxed">{code}</pre>
      <button
        onClick={copy}
        className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300 rounded opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Copy className="h-3 w-3" />
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function DocSection({ title, children }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

function DocsPanel({ onClose }) {
  return (
    <div className="w-80 shrink-0 border-l border-gray-800 flex flex-col overflow-hidden bg-gray-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-200">SDK Reference</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs text-gray-400">

        <DocSection title="Reading the trigger payload">
          <p>Run input arrives as JSON in <code className="text-indigo-300 bg-gray-800 px-1 rounded">TRIGGER_PAYLOAD</code>. Prefer the SDK helper so every PyBook uses the same pattern:</p>
          <CodeSnippet code={`import pylo_sdk as pylo

payload = pylo.get_payload()
entry_id = payload.get("entry_id")
entry_data = payload.get("entry_data", {})
score = payload.get("vt_score", 0)`} />
          <p className="text-gray-600 text-[10px] mt-1">Payloads are inputs. Output variables are separate and are created with <span className="font-mono text-indigo-400">pylo.set_output()</span>.</p>
        </DocSection>

        <DocSection title="Exporting output variables">
          <p>Publish values for downstream workflow nodes to consume via edge payload mappings (<code className="text-indigo-300 bg-gray-800 px-1 rounded">$.vars.key</code>). Export one at a time or all locals at once:</p>
          <CodeSnippet code={`import pylo_sdk as pylo

# One at a time
pylo.set_output("alert_id", "abc-123")
pylo.set_output("vt_score", 0.92)

# Or export all local variables in one call
vt_score = 0.92
is_malicious = vt_score > 0.7
alert_id = "abc-123"
pylo.export_vars(locals())`} />
          <p className="text-gray-600 text-[10px] mt-1">Reference in edge mappings: <span className="font-mono text-indigo-400">$.vars.vt_score</span>. Variables appear in the <em>Variables</em> panel after the run completes.</p>
        </DocSection>

        <DocSection title="Accessing secrets">
          <p>Select stored secrets in <em>Required API keys / secrets</em>; they are injected as env vars:</p>
          <CodeSnippet code={`import os

api_key = os.environ["SECRET_virustotal_api_key"]
token   = os.environ["SECRET_slack_bot_token"]`} />
        </DocSection>

        <DocSection title="Calling sub-PyBooks">
          <CodeSnippet code={`import pylo_sdk as pylo

result = pylo.call_sub_pybook(
    "sub-pybook-id",
    payload={"ip": "1.2.3.4"}
)
# result: {"id": "...", "status": "success", ...}`} />
        </DocSection>

        <DocSection title="Searching & reading entries">
          <CodeSnippet code={`import pylo_sdk as pylo

# Full-text search across all blueprints
entries = pylo.search_entries("malware")

# Filter by blueprint
entries = pylo.search_entries(
    "suspicious",
    type_id="blueprint-uuid"
)

# Fetch a single entry by ID
entry = pylo.get_entry("entry-uuid")
value = entry["data"]["field_name"]`} />
        </DocSection>

        <DocSection title="Available environment variables">
          <div className="rounded border border-gray-800 overflow-hidden">
            {[
              ["TRIGGER_PAYLOAD", "JSON string with trigger input"],
              ["PYLO_RUN_ID",     "Current run UUID"],
              ["PYLO_PYBOOK_ID",  "This PyBook's UUID"],
              ["PYLO_API_URL",    "Backend base URL"],
              ["SECRET_<name>",   "Injected secret value"],
            ].map(([k, v]) => (
              <div key={k} className="flex border-b border-gray-800 last:border-0">
                <div className="w-40 shrink-0 px-2.5 py-2 font-mono text-[10px] text-indigo-300 bg-gray-950 border-r border-gray-800">{k}</div>
                <div className="px-2.5 py-2 text-[10px] text-gray-500">{v}</div>
              </div>
            ))}
          </div>
        </DocSection>

        <DocSection title="Full example — workflow node">
          <CodeSnippet code={`import os
import pylo_sdk as pylo

# 1. Read upstream payload
payload = pylo.get_payload()
alert_id = payload.get("alert_id", "")

# 2. Do work
api_key = os.environ["SECRET_vt_api_key"]
# ... call VirusTotal, etc.
score = 0.87

# 3. Export for downstream nodes
pylo.set_output("vt_score", score)
pylo.set_output("alert_id", alert_id)
pylo.set_output("is_malicious", score > 0.7)

print(f"Score: {score}")`} />
        </DocSection>

      </div>
    </div>
  )
}


// ── Config Panel ──────────────────────────────────────────────────────────────

function ConfigPanel({ pybook, onClose, onSaved, isAdmin, isProd = false, secrets = [] }) {
  const [form, setForm] = useState({
    name: pybook.name || '',
    description: pybook.description || '',
    dependencies: pybook.dependencies || '[]',
    required_secrets: pybook.required_secrets || '[]',
    is_sub_pybook: !!pybook.is_sub_pybook,
    network_policy: pybook.network_policy || 'default',
    allowed_hosts: pybook.allowed_hosts || '[]',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    for (const field of ['dependencies', 'required_secrets', 'allowed_hosts']) {
      try { JSON.parse(form[field] || '[]') }
      catch { setError(`Invalid JSON in ${field}`); return }
    }
    setSaving(true); setError(null)
    try {
      await onSaved(form)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="w-80 shrink-0 border-l border-gray-800 flex flex-col overflow-hidden bg-gray-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-200">Settings</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded">{error}</p>}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} disabled={!isAdmin}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Description</label>
          <input value={form.description} onChange={e => set('description', e.target.value)} disabled={!isAdmin}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Dependencies <span className="text-gray-600">(pip packages, JSON array)</span>
          </label>
          <input value={form.dependencies} onChange={e => set('dependencies', e.target.value)} disabled={!isAdmin}
            placeholder='["pandas", "boto3"]'
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
          <p className="text-xs text-gray-600 mt-1">requests, httpx, pydantic are always available</p>
        </div>
        <div>
          <RequiredSecretsSelect
            value={form.required_secrets}
            onChange={value => set('required_secrets', value)}
            secrets={secrets}
            disabled={!isAdmin}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Network policy</label>
          <select value={form.network_policy} onChange={e => set('network_policy', e.target.value)} disabled={!isAdmin}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50">
            <option value="default">Default (shared network)</option>
            <option value="none">None (no network access)</option>
            <option value="allowlisted">Allowlisted hosts only</option>
          </select>
          {form.network_policy === 'allowlisted' && (
            <div className="mt-2">
              <label className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                Allowed hosts <span className="text-gray-600">(JSON array)</span>
                <InlineHelp text={'Enter hostnames only, not full URLs. Example: ["api.abuseipdb.com", "api.github.com"]. Pylo allows network access through the shared Docker network, but only these hostnames are intended to resolve for this PyBook. Do not include https://, paths, headers, or secret values here.'} />
              </label>
              <input value={form.allowed_hosts} onChange={e => set('allowed_hosts', e.target.value)} disabled={!isAdmin}
                placeholder='["api.abuseipdb.com", "api.github.com"]'
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="cfg_is_sub" checked={form.is_sub_pybook}
            disabled={!isAdmin} onChange={e => set('is_sub_pybook', e.target.checked)}
            className="rounded border-gray-600 disabled:opacity-50" />
          <label htmlFor="cfg_is_sub" className="text-sm text-gray-300">
            Sub-PyBook <span className="text-xs text-gray-500">(callable by other PyBooks)</span>
          </label>
        </div>
        {isAdmin && !isProd && (
          <button onClick={handleSave} disabled={saving}
            className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        )}
        {isProd && (
          <p className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700 rounded px-3 py-2">
            Production — read-only
          </p>
        )}
        <div className="border-t border-[#343746] pt-3 mt-1">
          <p className="text-xs text-[#6272a4] mb-2">Export</p>
          <button
            onClick={async () => { try { await exportApi.pybook(pybook.id) } catch {} }}
            className="w-full px-3 py-2 bg-[#282a36] hover:bg-[#343746] rounded text-xs text-[#8b8fa3] hover:text-[#f8f8f2] transition-colors text-left">
            Download .json
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AI Prompt Modal ───────────────────────────────────────────────────────────

const PYLO_AI_PROMPT = `You are helping write a PyBook script for Pylo, an internal security automation platform.

## What is Pylo?
Pylo is a workflow automation platform where scripts called PyBooks run in isolated Docker containers. PyBooks can be triggered manually, on a cron schedule, by webhooks, or when new entries are created in a Blueprint (structured data store). They can also be chained together in visual Workflows.

## PyBook execution environment
- Python 3.11+ isolated container
- Pre-installed: requests, httpx, pydantic
- Custom pip packages declared in the PyBook's "dependencies" field
- Script runs as: python /pybook/main.py

## Available environment variables
- TRIGGER_PAYLOAD: JSON string with input data (manual run, Entry selection, webhook, Blueprint trigger, or workflow edge)
- PYLO_RUN_ID: UUID of the current run
- PYLO_PYBOOK_ID: UUID of this PyBook
- PYLO_API_URL: Backend base URL (http://backend:8000 inside containers)
- SECRET_<name>: Injected secret values selected in Required API keys / secrets

## pylo_sdk functions (auto-mounted, import as: import pylo_sdk as pylo)

\`\`\`python
# Read run input payload
payload = pylo.get_payload()

# Search blueprint entries
entries = pylo.search_entries("keyword", type_id="blueprint-uuid-optional")
# Returns: [{"id": "...", "title": "...", "data": "<JSON string>", ...}, ...]

# IMPORTANT: entry["data"] is always a JSON string, parse it:
entry = pylo.get_entry("entry-uuid")
data = json.loads(entry["data"])  # <-- required!

# Export output variable for downstream workflow nodes
pylo.set_output("key", value)          # one at a time
pylo.export_vars(locals())             # export all local variables at once

# Call a sub-PyBook and wait for result
result = pylo.call_sub_pybook("sub-uuid", payload={"key": "value"})
# result: {"id": "...", "status": "success", "output_vars": {...}}
\`\`\`

## Standard script template
\`\`\`python
import json
import os
import pylo_sdk as pylo

# Read trigger payload (input from manual run, Entry selection, webhook, or workflow)
payload = pylo.get_payload()

# Access a selected API key / secret
api_key = os.environ["SECRET_my_api_key"]

# Do work
result = "computed value"

# Export for downstream workflow nodes
pylo.set_output("result", result)
print(f"Done: {result}")
\`\`\`

## Common patterns

### Blueprint-triggered PyBook (process new entries)
\`\`\`python
import json
import pylo_sdk as pylo

payload = pylo.get_payload()
entry_id = payload.get("entry_id") or payload.get("id")
entry = pylo.get_entry(entry_id)
data = json.loads(entry["data"])  # parse the data field!
title = entry.get("title", "")

# process data...
pylo.set_output("processed", True)
\`\`\`

### Batch processing all blueprint entries
\`\`\`python
import json
import pylo_sdk as pylo

payload = pylo.get_payload()
blueprint_id = payload.get("blueprint_id", "your-blueprint-uuid")
entries = pylo.search_entries("", type_id=blueprint_id)

results = []
for item in entries:
    entry = pylo.get_entry(item["id"])
    data = json.loads(entry["data"])  # always parse!
    # process...

pylo.set_output("count", len(results))
\`\`\`

## Important notes
- Always add: import os, json at the top
- entry["data"] is ALWAYS a JSON string — always use json.loads()
- set_output() is the ONLY way to pass data to the next workflow node
- Print statements go to stdout (visible in run logs)
- Raise exceptions to mark the run as failed
- Default timeout: 300s — print progress for long-running tasks
`

function AIPromptModal({ onClose }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(PYLO_AI_PROMPT).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl flex flex-col shadow-2xl" style={{maxHeight: '80vh'}}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold">AI Prompt — PyBook Assistant</h2>
            <p className="text-xs text-gray-500 mt-0.5">Copy into any LLM to get context-aware help writing PyBook scripts</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none ml-4">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap bg-gray-950 rounded-lg p-4 border border-gray-800 leading-relaxed">
            {PYLO_AI_PROMPT}
          </pre>
        </div>
        <div className="px-5 py-4 border-t border-gray-800 shrink-0 flex justify-between items-center">
          <p className="text-xs text-gray-600">Paste into ChatGPT, Claude, Gemini, etc. as a system prompt or first message.</p>
          <button onClick={copy}
            className={"px-4 py-2 rounded text-sm font-medium transition-colors " + (copied ? "bg-green-700 text-green-100" : "bg-indigo-600 hover:bg-indigo-500")}>
            {copied ? "Copied!" : "Copy prompt"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main PyBooks page ─────────────────────────────────────────────────────────

export default function PyBooks() {
  const [pybooks, setPybooks] = useState([])
  const [blueprints, setBlueprints] = useState([])
  const [secrets, setSecrets] = useState([])
  const [selected, setSelected] = useState(null)
  const [script, setScript] = useState("")
  const [showNew, setShowNew] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [selectedTags, setSelectedTags] = useState(null)
  const [showDocs, setShowDocs] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showAIPrompt, setShowAIPrompt] = useState(false)
  const [showTriggerEdit, setShowTriggerEdit] = useState(false)
  const [triggerDraft, setTriggerDraft] = useState(null)
  const [importConflicts, setImportConflicts] = useState(null)
  const [importData, setImportData] = useState(null)
  const [importError, setImportError] = useState(null)
  const importRef = useRef(null)

  // Filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'top' | 'sub'
  const [activeTag, setActiveTag] = useState('')

  const { isAdmin } = useAuth()
  const { isProd } = useGitops()
  const load = () => {
    setLoadError(null)
    return pybooksApi.list()
      .then(data => { setPybooks(data) })
      .catch(err => {
        console.error(err)
        setLoadError(err.message || 'Failed to load PyBooks')
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    blueprintsApi.listBlueprints().then(setBlueprints).catch(() => {})
    secretsApi.list().then(setSecrets).catch(() => {})
  }, [])

  const scriptChanged = selected && script !== (selected.script || "")

  useEffect(() => {
    if (!scriptChanged) return
    const handler = (e) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [scriptChanged])

  const selectPybook = (pb) => {
    setSelected(pb)
    setScript(pb.script || "")
    setShowNew(false)
    setShowConfig(false)
    setShowTriggerEdit(false)
    setTriggerDraft(null)
    try { setSelectedTags(JSON.parse(pb.tags || '[]')) } catch { setSelectedTags([]) }
  }

  const handleSaveTrigger = async () => {
    if (!selected || !triggerDraft) return
    const updated = await pybooksApi.update(selected.id, {
      trigger_type: triggerDraft.type,
      trigger_config: triggerDraft.config,
    })
    setSelected(updated)
    setShowTriggerEdit(false)
    setTriggerDraft(null)
    load()
  }

  const handleSaveConfig = async (fields) => {
    if (!selected) return
    const updated = await pybooksApi.update(selected.id, fields)
    setSelected(updated)
    load()
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const updated = await pybooksApi.update(selected.id, { script })
      setSelected(updated); load()
    } finally { setSaving(false) }
  }

  const handleSaveTags = async (tags) => {
    if (!selected) return
    const updated = await pybooksApi.update(selected.id, { tags: JSON.stringify(tags) })
    setSelected(updated)
    setSelectedTags(tags)
    load()
  }

  const handleCreate = async (data) => { await pybooksApi.create(data); setShowNew(false); load() }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const parsed = await readImportFile(file)
      if (parsed.pylo_export !== 'pybook') { setImportError('This file is not a PyBook export.'); return }
      const res = await importApi.pybook(parsed)
      if (!res.ok) { setImportData(parsed); setImportConflicts(res.conflicts) }
      else { load(); selectPybook(res.result) }
    } catch (err) { setImportError(err.message) }
  }

  const handleImportResolve = async ({ main, pybooks: pybookRes }) => {
    setImportError(null)
    try {
      const res = await importApi.pybook(importData, main, pybookRes)
      if (!res.ok) { setImportConflicts(res.conflicts) }
      else { setImportConflicts(null); setImportData(null); load(); selectPybook(res.result) }
    } catch (err) { setImportError(err.message); setImportConflicts(null) }
  }

  const handleDelete = async () => {
    if (!selected || !confirm(`Delete "${selected.name}"?`)) return
    await pybooksApi.delete(selected.id)
    setSelected(null); setScript(""); setSelectedTags(null); load()
  }

  const handleToggleActive = async () => {
    if (!selected) return
    const updated = await pybooksApi.update(selected.id, { is_active: !selected.is_active })
    setSelected(updated); load()
  }

  // Collect all unique tags
  const allTags = [...new Set(pybooks.flatMap(pb => { try { return JSON.parse(pb.tags || '[]') } catch { return [] } }))]

  // Filtered list
  const filtered = pybooks.filter(pb => {
    if (search && !pb.name.toLowerCase().includes(search.toLowerCase())) return false
    if (typeFilter === 'top' && pb.is_sub_pybook) return false
    if (typeFilter === 'sub' && !pb.is_sub_pybook) return false
    if (activeTag) {
      try { if (!JSON.parse(pb.tags || '[]').includes(activeTag)) return false }
      catch { return false }
    }
    return true
  })

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  if (loadError) return (
    <div className="flex h-full items-center justify-center bg-[#191a21] text-[#f8f8f2]">
      <div className="max-w-md rounded border border-[#343746] bg-[#20222c] p-5">
        <h1 className="text-sm font-semibold">PyBooks could not load</h1>
        <p className="mt-2 break-words text-xs text-[#ff5555]">{loadError}</p>
        <button
          onClick={() => { setLoading(true); load() }}
          className="mt-4 rounded bg-[#bd93f9] px-3 py-2 text-xs font-semibold text-[#191a21] hover:bg-[#caa9fa]"
        >
          Retry
        </button>
      </div>
    </div>
  )

  if (showNew) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">New PyBook</h1>
      <NewPyBookForm onSave={handleCreate} onCancel={() => setShowNew(false)} blueprints={blueprints} secrets={secrets} />
    </div>
  )

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden bg-[#191a21] text-[#f8f8f2]">
      {showAIPrompt && <AIPromptModal onClose={() => setShowAIPrompt(false)} />}
      {importConflicts && (
        <ImportConflictModal
          conflicts={importConflicts}
          onResolve={handleImportResolve}
          onCancel={() => { setImportConflicts(null); setImportData(null) }}
        />
      )}
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />

      {/* Sidebar */}
      <div className="w-72 shrink-0 bg-[#151720] border-r border-[#343746] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[#343746] shrink-0">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#f8f8f2]">
              <BookOpen className="h-4 w-4 text-[#8be9fd]" />
              <span>PyBooks</span>
            </div>
            <p className="mt-0.5 text-xs text-[#6272a4]">{filtered.length} visible</p>
          </div>
          <div className="flex items-center gap-1.5">
            {importError && <span className="text-xs text-red-400 max-w-24 truncate" title={importError}>!</span>}
            <button onClick={() => importRef.current?.click()} disabled={!isAdmin}
              className="inline-flex items-center gap-1 text-xs bg-[#282a36] hover:bg-[#343746] disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1.5 rounded text-[#8b8fa3]"
              title="Import PyBook from file">
              Import
            </button>
            <button onClick={() => { setShowNew(true); setSelected(null) }} disabled={!isAdmin}
              className="inline-flex items-center gap-1.5 text-xs bg-[#bd93f9] text-[#191a21] hover:bg-[#caa9fa] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 rounded font-semibold">
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-3 border-b border-[#343746] shrink-0">
          <div className="flex items-center gap-2 rounded border border-[#343746] bg-[#191a21] px-2.5 py-2 focus-within:border-[#8be9fd]">
            <Search className="h-3.5 w-3.5 text-[#6272a4]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search PyBooks"
              className="w-full bg-transparent text-xs text-[#f8f8f2] outline-none placeholder-[#6272a4]"
            />
          </div>
        </div>

        {/* Type filter */}
        <div className="flex gap-1 px-3 py-3 border-b border-[#343746] shrink-0">
          {[['all','All'],['top','Top-level'],['sub','Sub']].map(([v,l]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`flex-1 text-xs py-1.5 rounded transition-colors ${typeFilter === v ? 'bg-[#44475a] text-[#8be9fd]' : 'bg-[#20222c] text-[#8b8fa3] hover:bg-[#282a36]'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-3 border-b border-[#343746] shrink-0">
            {allTags.map(t => (
              <TagChip key={t} tag={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? '' : t)} />
            ))}
          </div>
        )}

        {/* PyBook list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-xs text-[#6272a4] italic p-4">
              {pybooks.length === 0 ? 'No PyBooks yet.' : 'No matches.'}
            </p>
          )}
          {filtered.map(pb => {
            const pbTags = (() => { try { return JSON.parse(pb.tags || '[]') } catch { return [] } })()
            return (
              <div key={pb.id} onClick={() => selectPybook(pb)}
                className={"px-4 py-3 cursor-pointer border-b border-[#282a36] hover:bg-[#20222c] transition-colors" + (selected?.id === pb.id ? " bg-[#282a36]" : "")}>
                <div className="flex items-center gap-2">
                  <span className={"w-2 h-2 rounded-full shrink-0 " + (pb.is_active ? "bg-[#50fa7b]" : "bg-[#6272a4]")} />
                  <p className="text-sm font-medium truncate text-[#f8f8f2]">{pb.name}</p>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-[#6272a4]">{pb.trigger_type}</span>
                  {pb.is_sub_pybook && <span className="text-xs text-[#ff79c6]">sub</span>}
                </div>
                {pbTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {pbTags.map(t => <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-[#343746] text-[#8b8fa3]">{t}</span>)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Editor area */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-[#6272a4] text-sm">
          <div className="text-center">
            <Code2 className="mx-auto mb-3 h-8 w-8 text-[#44475a]" />
            <p>Select a PyBook to edit</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-[#343746] bg-[#20222c] shrink-0 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={"w-2 h-2 rounded-full shrink-0 " + (selected.is_active ? "bg-[#50fa7b]" : "bg-[#6272a4]")} />
                  <span className="text-sm font-semibold truncate text-[#f8f8f2]">{selected.name}</span>
                </div>
                <p className="mt-0.5 text-xs text-[#6272a4] truncate">{selected.description || selected.trigger_type}</p>
              </div>
              <button onClick={handleToggleActive} disabled={!isAdmin}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#282a36] hover:bg-[#343746] disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {selected.is_active ? "Disable" : "Enable"}
              </button>
              <button onClick={() => { setShowRuns(s => !s); setShowDocs(false); setShowConfig(false) }}
                className={"inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors " + (showRuns ? "bg-[#8be9fd] text-[#191a21]" : "bg-[#282a36] hover:bg-[#343746]")}>
                <ClipboardList className="h-3.5 w-3.5" />
                Runs
              </button>
              <button onClick={() => { setShowDocs(s => !s); setShowRuns(false); setShowConfig(false) }}
                className={"inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors " + (showDocs ? "bg-[#bd93f9] text-[#191a21]" : "bg-[#282a36] hover:bg-[#343746]")}>
                <FileText className="h-3.5 w-3.5" />
                SDK
              </button>
              <button onClick={() => { setShowConfig(s => !s); setShowRuns(false); setShowDocs(false) }}
                className={"inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors " + (showConfig ? "bg-[#bd93f9] text-[#191a21]" : "bg-[#282a36] hover:bg-[#343746]")}>
                <Settings2 className="h-3.5 w-3.5" />
                Settings
              </button>
              <button onClick={() => setShowAIPrompt(true)}
                title="Copy AI prompt for writing PyBook scripts"
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#282a36] hover:bg-[#343746] hover:text-[#ff79c6] rounded transition-colors">
                <Sparkles className="h-3.5 w-3.5" />
                AI Prompt
              </button>
              <button onClick={handleDelete} disabled={!isAdmin}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#282a36] hover:bg-[#3a1f2c] disabled:opacity-50 disabled:cursor-not-allowed text-[#8b8fa3] hover:text-[#ff79c6] rounded transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              {scriptChanged && !isProd && (
                <button onClick={handleSave} disabled={saving || !isAdmin}
                  className="text-xs px-3 py-1.5 bg-[#50fa7b] text-[#191a21] hover:bg-[#69ff94] disabled:opacity-50 disabled:cursor-not-allowed rounded font-semibold transition-colors">
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
              {isProd && (
                <span className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700 px-2.5 py-1 rounded">
                  Production — read-only
                </span>
              )}
            </div>

            {/* Tags bar */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#343746] bg-[#191a21] shrink-0">
              <span className="inline-flex items-center gap-1.5 text-xs text-[#8b8fa3] shrink-0">
                <Tags className="h-3.5 w-3.5" />
                Tags
              </span>
              <div className="flex-1">
                <TagInput
                  tags={selectedTags || []}
                  onChange={tags => { setSelectedTags(tags); handleSaveTags(tags) }}
                />
              </div>
            </div>

            {/* Trigger config bar */}
            <div className="border-b border-[#343746] bg-[#191a21] shrink-0">
              {!showTriggerEdit ? (
                <div className="flex items-center gap-2 px-5 py-2">
                  <Zap className="h-3.5 w-3.5 text-[#ffb86c]" />
                  <span className="text-xs text-[#6272a4]">Trigger</span>
                  <span className="text-xs text-[#8be9fd] font-medium">{selected.trigger_type}</span>
                  {selected.trigger_type === 'blueprint' && (() => {
                    const cfg = (() => { try { return JSON.parse(selected.trigger_config || '{}') } catch { return {} } })()
                    const bp = blueprints.find(b => b.id === cfg.blueprint_id)
                    return bp ? <span className="text-xs text-[#8b8fa3]">→ {bp.name}</span> : null
                  })()}
                  {selected.trigger_type === 'cron' && (() => {
                    const cfg = (() => { try { return JSON.parse(selected.trigger_config || '{}') } catch { return {} } })()
                    return cfg.cron ? <span className="text-xs text-[#8b8fa3] font-mono">{cfg.cron}</span> : null
                  })()}
                  <button
                    onClick={() => {
                      setTriggerDraft({ type: selected.trigger_type, config: selected.trigger_config || '{}' })
                      setShowTriggerEdit(true)
                    }}
                    className="ml-auto text-xs text-[#6272a4] hover:text-[#8be9fd] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  disabled={!isAdmin}>Edit trigger</button>
                </div>
              ) : (
                <div className="px-5 py-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#8b8fa3] font-medium shrink-0">Trigger type</span>
                    <select
                      value={triggerDraft?.type || 'manual'}
                      onChange={e => setTriggerDraft(d => ({ ...d, type: e.target.value, config: '{}' }))}
                      className="bg-[#20222c] border border-[#343746] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#8be9fd]"
                    >
                      {TRIGGER_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <div className="flex gap-2 ml-auto">
                      <button onClick={handleSaveTrigger} disabled={!isAdmin}
                        className="text-xs px-3 py-1 bg-[#50fa7b] text-[#191a21] hover:bg-[#69ff94] disabled:opacity-50 disabled:cursor-not-allowed rounded font-semibold transition-colors">Save</button>
                      <button onClick={() => { setShowTriggerEdit(false); setTriggerDraft(null) }}
                        className="text-xs px-3 py-1 bg-[#282a36] hover:bg-[#343746] rounded transition-colors">Cancel</button>
                    </div>
                  </div>
                  {triggerDraft?.type === 'cron' && (
                    <ScheduleBuilder
                      value={(() => { try { return JSON.parse(triggerDraft.config).cron || "" } catch { return "" } })()}
                      onChange={cron => setTriggerDraft(d => ({ ...d, config: JSON.stringify({ cron }) }))}
                    />
                  )}
                  {triggerDraft?.type === 'blueprint' && (
                    <BlueprintTriggerConfig
                      triggerConfig={triggerDraft.config}
                      onChange={v => setTriggerDraft(d => ({ ...d, config: v }))}
                      blueprints={blueprints}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1">
              <CodeEditor value={script} onChange={setScript} height="100%" />
            </div>
            {showRuns && (
              <div className="h-[48%] min-h-[420px] shrink-0 overflow-hidden">
                <RunPanel pybook={selected} onClose={() => setShowRuns(false)} isAdmin={isAdmin} />
              </div>
            )}
          </div>
          {showDocs && (
            <DocsPanel onClose={() => setShowDocs(false)} />
          )}
          {showConfig && (
            <ConfigPanel
              pybook={selected}
              onClose={() => setShowConfig(false)}
              onSaved={handleSaveConfig}
              isAdmin={isAdmin}
              isProd={isProd}
              secrets={secrets}
            />
          )}
        </div>
      )}
    </div>
  )
}
