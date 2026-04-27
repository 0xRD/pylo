import { useEffect, useRef, useState } from "react"
import CodeEditor from "../components/CodeEditor"
import RunStatusBadge from "../components/RunStatusBadge"
import { pybooksApi } from "../api/pybooks"
import { blueprintsApi } from "../api/blueprints"
import ScheduleBuilder from "../components/ScheduleBuilder"
import { useAuth } from "../context/AuthContext"

const DEFAULT_SCRIPT = `# Your PyBook script
# Available: requests, httpx, pydantic (always)
# Access secrets via os.environ["SECRET_your_key"]
# Call sub-PyBooks via pylo_sdk (auto-mounted at /pybook/pylo_sdk.py)

print("Hello from Pylo!")
`

const TRIGGER_TYPES = ["manual", "cron", "webhook", "blueprint"]
const TERMINAL = new Set(["success", "error", "timeout"])

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
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      }`}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onRemove(tag) }}
          className="hover:text-red-300 leading-none"
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
    <div className="flex flex-wrap gap-1.5 items-center bg-gray-800 border border-gray-700 rounded px-2 py-1.5 min-h-9 focus-within:border-indigo-500 transition-colors">
      {tags.map(t => (
        <TagChip key={t} tag={t} onRemove={tag => onChange(tags.filter(x => x !== tag))} />
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={add}
        placeholder={tags.length === 0 ? 'Add tags… (press Enter)' : ''}
        className="bg-transparent outline-none text-xs text-gray-200 placeholder-gray-600 flex-1 min-w-20"
      />
    </div>
  )
}

// ── New PyBook form ───────────────────────────────────────────────────────────

function NewPyBookForm({ onSave, onCancel, blueprints = [] }) {
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
          <label className="block text-xs text-gray-400 mb-1">Required secrets (JSON array)</label>
          <input value={form.required_secrets} onChange={e => set("required_secrets", e.target.value)}
            placeholder='["virustotal_api_key"]'
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
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

function RunPanel({ pybook, onClose, isAdmin }) {
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const [running, setRunning] = useState(false)
  const wsRef = useRef(null)
  const pollRef = useRef(null)

  const loadRuns = () => pybooksApi.getRuns(pybook.id).then(setRuns).catch(console.error)

  useEffect(() => {
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

  const handleRun = async () => {
    setRunning(true)
    try {
      const run = await pybooksApi.run(pybook.id)
      setSelectedRun(run); connectWs(run.id); loadRuns()
    } finally { setRunning(false) }
  }

  return (
    <div className="flex flex-col h-full border-l border-gray-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-medium">Runs</span>
        <div className="flex items-center gap-2">
          <button onClick={handleRun} disabled={running || !isAdmin}
            className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors">
            {running ? "Starting..." : "Run"}
          </button>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 border-r border-gray-800 overflow-y-auto">
          {runs.length === 0 && <p className="text-xs text-gray-600 p-3 italic">No runs yet.</p>}
          {runs.map(run => (
            <div key={run.id}
              onClick={() => { setSelectedRun(run); if (!TERMINAL.has(run.status)) connectWs(run.id) }}
              className={"px-3 py-2 cursor-pointer border-b border-gray-800 hover:bg-gray-800" + (selectedRun?.id === run.id ? " bg-gray-800" : "")}>
              <RunStatusBadge status={run.status} />
              <p className="text-xs text-gray-500 mt-1">{new Date(run.started_at).toLocaleTimeString()}</p>
              {run.duration_ms != null && <p className="text-xs text-gray-600">{run.duration_ms}ms</p>}
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!selectedRun ? (
            <p className="text-xs text-gray-600 italic">Select a run to view logs.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <RunStatusBadge status={selectedRun.status} />
                <span className="text-xs text-gray-500">{selectedRun.trigger_source}</span>
                {selectedRun.duration_ms != null && <span className="text-xs text-gray-600">{selectedRun.duration_ms}ms</span>}
              </div>
              {selectedRun.stdout && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">stdout</p>
                  <pre className="bg-gray-950 rounded p-2 text-xs font-mono text-green-300 whitespace-pre-wrap overflow-auto max-h-48">{selectedRun.stdout}</pre>
                </div>
              )}
              {selectedRun.stderr && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">stderr</p>
                  <pre className="bg-gray-950 rounded p-2 text-xs font-mono text-red-300 whitespace-pre-wrap overflow-auto max-h-48">{selectedRun.stderr}</pre>
                </div>
              )}
              {(() => {
                let vars = {}
                try { vars = JSON.parse(selectedRun.output_vars || '{}') } catch {}
                const entries = Object.entries(vars)
                if (entries.length === 0) return null
                return (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Variables</p>
                    <div className="bg-gray-950 rounded divide-y divide-gray-800">
                      {entries.map(([k, v]) => (
                        <div key={k} className="flex gap-3 px-2 py-1.5 text-xs">
                          <span className="text-indigo-400 font-mono shrink-0">{k}</span>
                          <span className="text-gray-300 font-mono truncate">{JSON.stringify(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
              {!selectedRun.stdout && !selectedRun.stderr && !TERMINAL.has(selectedRun.status) && (
                <p className="text-xs text-gray-500 italic animate-pulse">Running...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
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
        className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300 rounded opacity-0 group-hover:opacity-100 transition-opacity"
      >{copied ? 'Copied!' : 'Copy'}</button>
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
          <p>When triggered by a workflow edge mapping, the mapped keys arrive in <code className="text-indigo-300 bg-gray-800 px-1 rounded">TRIGGER_PAYLOAD</code>:</p>
          <CodeSnippet code={`import json, os

payload = json.loads(
    os.environ.get("TRIGGER_PAYLOAD", "{}")
)

alert_id = payload.get("alert_id")
score    = payload.get("vt_score", 0)`} />
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
          <p>Secrets declared in <em>Required secrets</em> are injected as env vars:</p>
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
          <CodeSnippet code={`import json, os
import pylo_sdk as pylo

# 1. Read upstream payload
payload = json.loads(
    os.environ.get("TRIGGER_PAYLOAD", "{}")
)
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

// ── Main PyBooks page ─────────────────────────────────────────────────────────

export default function PyBooks() {
  const [pybooks, setPybooks] = useState([])
  const [blueprints, setBlueprints] = useState([])
  const [selected, setSelected] = useState(null)
  const [script, setScript] = useState("")
  const [showNew, setShowNew] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedTags, setSelectedTags] = useState(null)
  const [showDocs, setShowDocs] = useState(false)
  const [showTriggerEdit, setShowTriggerEdit] = useState(false)
  const [triggerDraft, setTriggerDraft] = useState(null)

  // Filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'top' | 'sub'
  const [activeTag, setActiveTag] = useState('')

  const { isAdmin } = useAuth()
  const load = () => pybooksApi.list().then(data => { setPybooks(data); setLoading(false) }).catch(console.error)
  useEffect(() => {
    load()
    blueprintsApi.listBlueprints().then(setBlueprints).catch(() => {})
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

  if (showNew) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">New PyBook</h1>
      <NewPyBookForm onSave={handleCreate} onCancel={() => setShowNew(false)} blueprints={blueprints} />
    </div>
  )

  return (
    <div className="flex h-full gap-0 -m-6">
      {/* Sidebar */}
      <div className="w-60 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <span className="text-sm font-semibold text-gray-300">PyBooks</span>
          <button onClick={() => { setShowNew(true); setSelected(null) }} disabled={!isAdmin}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded">+ New</button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-800 shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 placeholder-gray-600"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-1 px-3 py-2 border-b border-gray-800 shrink-0">
          {[['all','All'],['top','Top-level'],['sub','Sub']].map(([v,l]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`flex-1 text-xs py-1 rounded transition-colors ${typeFilter === v ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-800 shrink-0">
            {allTags.map(t => (
              <TagChip key={t} tag={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? '' : t)} />
            ))}
          </div>
        )}

        {/* PyBook list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-xs text-gray-600 italic p-4">
              {pybooks.length === 0 ? 'No PyBooks yet.' : 'No matches.'}
            </p>
          )}
          {filtered.map(pb => {
            const pbTags = (() => { try { return JSON.parse(pb.tags || '[]') } catch { return [] } })()
            return (
              <div key={pb.id} onClick={() => selectPybook(pb)}
                className={"px-4 py-3 cursor-pointer border-b border-gray-800 hover:bg-gray-800" + (selected?.id === pb.id ? " bg-gray-800" : "")}>
                <div className="flex items-center gap-1.5">
                  <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + (pb.is_active ? "bg-green-400" : "bg-gray-600")} />
                  <p className="text-sm truncate">{pb.name}</p>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-gray-600">{pb.trigger_type}</span>
                  {pb.is_sub_pybook && <span className="text-xs text-indigo-500">sub</span>}
                </div>
                {pbTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {pbTags.map(t => <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">{t}</span>)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Editor area */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Select a PyBook to edit
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 shrink-0 flex-wrap">
              <span className="text-sm font-medium">{selected.name}</span>
              <span className={"w-2 h-2 rounded-full shrink-0 " + (selected.is_active ? "bg-green-400" : "bg-gray-600")} />
              <span className="text-xs text-gray-500 flex-1 truncate">{selected.trigger_type}</span>
              <button onClick={handleToggleActive} disabled={!isAdmin}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors">
                {selected.is_active ? "Disable" : "Enable"}
              </button>
              <button onClick={() => { setShowRuns(s => !s); setShowDocs(false) }}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded transition-colors">Runs</button>
              <button onClick={() => { setShowDocs(s => !s); setShowRuns(false) }}
                className={"text-xs px-2 py-1 rounded transition-colors " + (showDocs ? "bg-indigo-700 text-white" : "bg-gray-800 hover:bg-gray-700")}>SDK</button>
              <button onClick={handleDelete} disabled={!isAdmin}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 hover:text-red-300 rounded transition-colors">Delete</button>
              {scriptChanged && (
                <button onClick={handleSave} disabled={saving || !isAdmin}
                  className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors">
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            {/* Tags bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
              <span className="text-xs text-gray-500 shrink-0">Tags:</span>
              <div className="flex-1">
                <TagInput
                  tags={selectedTags || []}
                  onChange={tags => { setSelectedTags(tags); handleSaveTags(tags) }}
                />
              </div>
            </div>

            {/* Trigger config bar */}
            <div className="border-b border-gray-800 bg-gray-950 shrink-0">
              {!showTriggerEdit ? (
                <div className="flex items-center gap-2 px-4 py-1.5">
                  <span className="text-xs text-gray-600">Trigger:</span>
                  <span className="text-xs text-indigo-400 font-medium">{selected.trigger_type}</span>
                  {selected.trigger_type === 'blueprint' && (() => {
                    const cfg = (() => { try { return JSON.parse(selected.trigger_config || '{}') } catch { return {} } })()
                    const bp = blueprints.find(b => b.id === cfg.blueprint_id)
                    return bp ? <span className="text-xs text-gray-500">→ {bp.name}</span> : null
                  })()}
                  {selected.trigger_type === 'cron' && (() => {
                    const cfg = (() => { try { return JSON.parse(selected.trigger_config || '{}') } catch { return {} } })()
                    return cfg.cron ? <span className="text-xs text-gray-500 font-mono">{cfg.cron}</span> : null
                  })()}
                  <button
                    onClick={() => {
                      setTriggerDraft({ type: selected.trigger_type, config: selected.trigger_config || '{}' })
                      setShowTriggerEdit(true)
                    }}
                    className="ml-auto text-xs text-gray-600 hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  disabled={!isAdmin}>Edit trigger</button>
                </div>
              ) : (
                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-medium shrink-0">Trigger type</span>
                    <select
                      value={triggerDraft?.type || 'manual'}
                      onChange={e => setTriggerDraft(d => ({ ...d, type: e.target.value, config: '{}' }))}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      {TRIGGER_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <div className="flex gap-2 ml-auto">
                      <button onClick={handleSaveTrigger} disabled={!isAdmin}
                        className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors">Save</button>
                      <button onClick={() => { setShowTriggerEdit(false); setTriggerDraft(null) }}
                        className="text-xs px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded transition-colors">Cancel</button>
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

            <div className="flex-1">
              <CodeEditor value={script} onChange={setScript} height="100%" />
            </div>
          </div>

          {showRuns && (
            <div className="w-80 shrink-0 flex flex-col overflow-hidden">
              <RunPanel pybook={selected} onClose={() => setShowRuns(false)} isAdmin={isAdmin} />
            </div>
          )}
          {showDocs && (
            <DocsPanel onClose={() => setShowDocs(false)} />
          )}
        </div>
      )}
    </div>
  )
}
