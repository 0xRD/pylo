import { useEffect, useRef, useState } from "react"
import CodeEditor from "../components/CodeEditor"
import RunStatusBadge from "../components/RunStatusBadge"
import { pybooksApi } from "../api/pybooks"

const DEFAULT_SCRIPT = `# Your PyBook script
# Available: requests, httpx, pydantic (always)
# Access secrets via os.environ["SECRET_your_key"]
# Call sub-PyBooks via pylo_sdk (auto-mounted at /pybook/pylo_sdk.py)

print("Hello from Pylo!")
`

const TRIGGER_TYPES = ["manual", "cron", "webhook", "object_event"]
const TERMINAL = new Set(["success", "error", "timeout"])

function NewPyBookForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    name: "", description: "", script: DEFAULT_SCRIPT,
    is_sub_pybook: false, dependencies: "[]",
    trigger_type: "manual", trigger_config: '{"cron": "0 * * * *"}', required_secrets: "[]",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try { await onSave(form) } catch (err) { setError(err.message); setSaving(false) }
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
        <div>
          <label className="block text-xs text-gray-400 mb-1">Cron expression <span className="text-gray-600">(e.g. hourly = 0 * * * *)</span></label>
          <input placeholder='{"cron": "0 * * * *"}' value={form.trigger_config}
            onChange={e => set("trigger_config", e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description</label>
        <input value={form.description} onChange={e => set("description", e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
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
          onChange={e => set("is_sub_pybook", e.target.checked)}
          className="rounded border-gray-600" />
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

function RunPanel({ pybook, onClose }) {
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const [running, setRunning] = useState(false)
  const wsRef = useRef(null)
  const pollRef = useRef(null)

  const loadRuns = () => pybooksApi.getRuns(pybook.id).then(setRuns).catch(console.error)

  useEffect(() => {
    loadRuns()
    pollRef.current = setInterval(loadRuns, 3000)
    return () => {
      clearInterval(pollRef.current)
      wsRef.current?.close()
    }
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
      if (TERMINAL.has(data.status)) {
        loadRuns()
        ws.close()
      }
    }
    ws.onerror = () => {}
  }

  const handleRun = async () => {
    setRunning(true)
    try {
      const run = await pybooksApi.run(pybook.id)
      setSelectedRun(run)
      connectWs(run.id)
      loadRuns()
    } finally { setRunning(false) }
  }

  return (
    <div className="flex flex-col h-full border-l border-gray-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-medium">Runs</span>
        <div className="flex items-center gap-2">
          <button onClick={handleRun} disabled={running}
            className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded transition-colors">
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
              {run.duration_ms != null && (
                <p className="text-xs text-gray-600">{run.duration_ms}ms</p>
              )}
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
                {selectedRun.duration_ms != null && (
                  <span className="text-xs text-gray-600">{selectedRun.duration_ms}ms</span>
                )}
              </div>
              {selectedRun.stdout && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">stdout</p>
                  <pre className="bg-gray-950 rounded p-2 text-xs font-mono text-green-300 whitespace-pre-wrap overflow-auto max-h-48">
                    {selectedRun.stdout}
                  </pre>
                </div>
              )}
              {selectedRun.stderr && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">stderr</p>
                  <pre className="bg-gray-950 rounded p-2 text-xs font-mono text-red-300 whitespace-pre-wrap overflow-auto max-h-48">
                    {selectedRun.stderr}
                  </pre>
                </div>
              )}
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

export default function PyBooks() {
  const [pybooks, setPybooks] = useState([])
  const [selected, setSelected] = useState(null)
  const [script, setScript] = useState("")
  const [showNew, setShowNew] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = () => pybooksApi.list().then(data => {
    setPybooks(data); setLoading(false)
  }).catch(console.error)

  useEffect(() => { load() }, [])

  const scriptChanged = selected && script !== (selected.script || "")

  useEffect(() => {
    if (!scriptChanged) return
    const handler = (e) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [scriptChanged])

  const selectPybook = (pb) => {
    setSelected(pb); setScript(pb.script || ""); setShowNew(false)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const updated = await pybooksApi.update(selected.id, { script })
      setSelected(updated)
      load()
    } finally { setSaving(false) }
  }

  const handleCreate = async (data) => {
    await pybooksApi.create(data)
    setShowNew(false)
    load()
  }

  const handleDelete = async () => {
    if (!selected || !confirm(`Delete "${selected.name}"?`)) return
    await pybooksApi.delete(selected.id)
    setSelected(null); setScript(""); load()
  }

  const handleToggleActive = async () => {
    if (!selected) return
    const updated = await pybooksApi.update(selected.id, { is_active: !selected.is_active })
    setSelected(updated); load()
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>

  if (showNew) return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">New PyBook</h1>
      <NewPyBookForm onSave={handleCreate} onCancel={() => setShowNew(false)} />
    </div>
  )

  return (
    <div className="flex h-full gap-0 -m-6">
      <div className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-semibold text-gray-300">PyBooks</span>
          <button onClick={() => { setShowNew(true); setSelected(null) }}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-1 rounded">+ New</button>
        </div>
        {pybooks.length === 0 && <p className="text-xs text-gray-600 italic p-4">No PyBooks yet.</p>}
        {pybooks.map(pb => (
          <div key={pb.id} onClick={() => selectPybook(pb)}
            className={"px-4 py-3 cursor-pointer border-b border-gray-800 hover:bg-gray-800" + (selected?.id === pb.id ? " bg-gray-800" : "")}>
            <div className="flex items-center gap-1.5">
              <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + (pb.is_active ? "bg-green-400" : "bg-gray-600")} />
              <p className="text-sm truncate">{pb.name}</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-600">{pb.trigger_type}</span>
              {pb.is_sub_pybook && <span className="text-xs text-indigo-500">sub</span>}
            </div>
          </div>
        ))}
      </div>

      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Select a PyBook to edit
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 shrink-0">
              <span className="text-sm font-medium">{selected.name}</span>
              <span className={"w-2 h-2 rounded-full " + (selected.is_active ? "bg-green-400" : "bg-gray-600")} />
              <span className="text-xs text-gray-500 flex-1">{selected.trigger_type}</span>
              <button onClick={handleToggleActive}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded transition-colors">
                {selected.is_active ? "Disable" : "Enable"}
              </button>
              <button onClick={() => setShowRuns(s => !s)}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded transition-colors">
                Runs
              </button>
              <button onClick={handleDelete}
                className="text-xs px-2 py-1 bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 rounded transition-colors">
                Delete
              </button>
              {scriptChanged && (
                <button onClick={handleSave} disabled={saving}
                  className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded transition-colors">
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>
            <div className="flex-1">
              <CodeEditor value={script} onChange={setScript} height="100%" />
            </div>
          </div>

          {showRuns && (
            <div className="w-80 shrink-0 flex flex-col overflow-hidden">
              <RunPanel pybook={selected} onClose={() => setShowRuns(false)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
