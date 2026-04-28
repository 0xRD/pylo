import { useEffect, useState } from 'react'
import { blueprintsApi } from '../api/blueprints'
import { secretsApi } from '../api/secrets'
import HelpTip from './HelpTip'
import ScheduleBuilder from './ScheduleBuilder'

function buildPath(parent, key) {
  if (parent === null) return '$'
  if (typeof key === 'number') return `${parent}[*]`
  return parent === '$' ? `$.${key}` : `${parent}.${key}`
}

function JsonNode({ label, data, path, onSelect, depth }) {
  const [open, setOpen] = useState(depth < 2)
  const isObj = data !== null && typeof data === 'object'
  const isArr = Array.isArray(data)
  const preview = isArr ? `[${data.length}]` : isObj ? `{${Object.keys(data).length}}` : JSON.stringify(data)

  return (
    <div className="leading-relaxed">
      <div className="flex items-center gap-1 group">
        {isObj
          ? <button type="button" onClick={() => setOpen(o => !o)} className="text-gray-600 w-3 text-xs shrink-0 hover:text-gray-400">{open ? '▾' : '▸'}</button>
          : <span className="w-3 shrink-0" />}
        <span className="text-blue-400 text-xs font-mono shrink-0">{label}</span>
        {!isObj && <><span className="text-gray-600 text-xs mx-0.5">:</span><span className="text-green-300 text-xs font-mono truncate max-w-32">{preview}</span></>}
        {isObj && !open && <span className="text-gray-600 text-xs ml-1">{preview}</span>}
        <button type="button" onClick={() => onSelect(path)} title={"Use path: " + path}
          className="ml-1 text-indigo-500 hover:text-indigo-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          → {path}
        </button>
      </div>
      {isObj && open && (
        <div className="ml-4 border-l border-gray-800 pl-2 mt-0.5">
          {isArr
            ? data.slice(0, 3).map((item, i) => <JsonNode key={i} label={`[${i}]`} data={item} path={buildPath(path, i)} onSelect={onSelect} depth={depth + 1} />)
            : Object.entries(data).map(([k, v]) => <JsonNode key={k} label={k} data={v} path={buildPath(path, k)} onSelect={onSelect} depth={depth + 1} />)}
          {isArr && data.length > 3 && <span className="text-xs text-gray-600 pl-1">… {data.length - 3} more</span>}
        </div>
      )}
    </div>
  )
}

function JsonTree({ data, onSelect }) {
  const root = Array.isArray(data) ? data[0] : data
  const label = Array.isArray(data) ? `[0] (of ${data.length})` : 'response'
  return (
    <div className="font-mono text-xs overflow-auto max-h-72 pr-1">
      <JsonNode label={label} data={root} path="$" onSelect={onSelect} depth={0} />
    </div>
  )
}

const EMPTY_MAPPING = { source_path: '', field_name: '', field_type: 'string', is_key: false, mutable: false }
const FIELD_TYPES = ['string', 'number', 'boolean', 'datetime']
const PAGINATION_TYPES = [
  ['none', 'No pagination'],
  ['page_number', 'Page number'],
  ['offset', 'Offset'],
  ['cursor', 'Cursor'],
]


export default function BlueprintForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', description: '', source_url: '', source_method: 'GET',
    source_headers: '{}', source_body: '{}', field_mappings: '[]',
    fetch_cron: '', fetch_is_active: false, is_manual: false, mutable_mode: 'none',
    pagination_type: 'none', pagination_param: '', pagination_path: '',
    pagination_items_path: '', pagination_max_pages: 50,
    max_entries: '', retention_days: '',
  })
  const [mappings, setMappings] = useState(() => { try { return JSON.parse(initial?.field_mappings || '[]').map(m => ({ mutable: false, ...m })) } catch { return [] } })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [focusedRow, setFocusedRow] = useState(null)
  const [secrets, setSecrets] = useState([])
  const [authType, setAuthType] = useState('none')
  const [authSecret, setAuthSecret] = useState('')
  const [authKeyHeader, setAuthKeyHeader] = useState('X-API-Key')

  useEffect(() => {
    secretsApi.list().then(setSecrets).catch(() => {})
    try {
      const h = JSON.parse(initial?.source_headers || '{}')
      const auth = h['Authorization'] || ''
      const bearerM = auth.match(/^Bearer \{\{secret:([^}]+)\}\}$/)
      const basicM  = auth.match(/^Basic \{\{secret:([^}]+)\}\}$/)
      if (bearerM) {
        setAuthType('bearer'); setAuthSecret(bearerM[1])
        setForm(f => ({ ...f, source_headers: JSON.stringify(Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'Authorization'))) }))
      } else if (basicM) {
        setAuthType('basic'); setAuthSecret(basicM[1])
        setForm(f => ({ ...f, source_headers: JSON.stringify(Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'Authorization'))) }))
      } else {
        for (const [k, v] of Object.entries(h)) {
          const m = v.match(/^\{\{secret:([^}]+)\}\}$/)
          if (m) {
            setAuthType('apikey'); setAuthSecret(m[1]); setAuthKeyHeader(k)
            setForm(f => ({ ...f, source_headers: JSON.stringify(Object.fromEntries(Object.entries(h).filter(([kk]) => kk !== k))) }))
            break
          }
        }
      }
    } catch {}
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setMapping = (i, k, v) => setMappings(ms => ms.map((m, idx) => idx === i ? { ...m, [k]: v } : m))
  const setKeyField = (i) => setMappings(ms => ms.map((m, idx) => ({ ...m, is_key: idx === i })))
  const hasKey = mappings.some(m => m.is_key)

  const handlePreview = async () => {
    setPreviewing(true); setPreviewResult(null); setPreviewError(null)
    try {
      setPreviewResult(await blueprintsApi.previewEndpoint({
        source_url: form.source_url,
        source_method: form.source_method,
        source_headers: form.source_headers || '{}',
        source_body: form.source_body || '{}',
        sample_limit: 1,
        pagination_type: form.pagination_type || 'none',
        pagination_param: form.pagination_param || null,
        pagination_items_path: form.pagination_items_path || null,
      }))
    } catch (err) { setPreviewError(err.message) }
    finally { setPreviewing(false) }
  }

  const handlePathSelect = (path) => {
    if (focusedRow !== null) setMapping(focusedRow, 'source_path', path)
    else setMappings(ms => [...ms, { ...EMPTY_MAPPING, source_path: path }])
  }

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError(null)
    try {
      const buildFinalHeaders = () => {
        try {
          const h = JSON.parse(form.source_headers || '{}')
          if (authType === 'bearer' && authSecret) h['Authorization'] = `Bearer {{secret:${authSecret}}}`
          else if (authType === 'basic'  && authSecret) h['Authorization'] = `Basic {{secret:${authSecret}}}`
          else if (authType === 'apikey' && authSecret) h[authKeyHeader] = `{{secret:${authSecret}}}`
          return JSON.stringify(h)
        } catch { return form.source_headers }
      }
      await onSave({
        ...form,
        source_headers: buildFinalHeaders(),
        field_mappings: JSON.stringify(mappings),
        fetch_cron: form.fetch_cron || null,
        pagination_type: form.pagination_type || 'none',
        pagination_param: form.pagination_type === 'none' ? null : (form.pagination_param || null),
        pagination_path: form.pagination_type === 'cursor' ? (form.pagination_path || null) : null,
        pagination_items_path: form.pagination_items_path || null,
        pagination_max_pages: Number(form.pagination_max_pages || 50),
        max_entries: form.max_entries ? Number(form.max_entries) : null,
        retention_days: form.retention_days ? Number(form.retention_days) : null,
      })
    } catch (err) { setError(err.message); setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-red-400 text-sm bg-red-950 px-3 py-2 rounded">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} required
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Description</label>
          <input value={form.description || ''} onChange={e => set('description', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input type="checkbox" checked={!!form.is_manual} onChange={e => set('is_manual', e.target.checked)} className="rounded border-gray-600" />
        <span className="text-sm text-gray-300">Manual blueprint<HelpTip text="Manual blueprints have no API source. Entries are created and managed directly in the UI — useful for shared variables, rule toggles, or allow/blocklists across PyBooks." /></span>
        <span className="text-xs text-gray-600">Entries are created manually — no API source needed</span>
      </label>

      {!form.is_manual && (<>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Source URL<HelpTip text="URL the orchestrator will call to fetch entries. Supports GET and POST. Use the Test button to preview the response." /></label>
          <div className="flex gap-2">
            <div className="flex flex-1 gap-2">
              <input value={form.source_url || ''} onChange={e => set('source_url', e.target.value)} placeholder="https://api.example.com/data"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              <select value={form.source_method} onChange={e => set('source_method', e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
                <option>GET</option><option>POST</option>
              </select>
            </div>
            <button type="button" onClick={handlePreview} disabled={!form.source_url || previewing}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-sm transition-colors shrink-0">
              {previewing ? 'Testing…' : 'Test'}
            </button>
          </div>
        </div>

        <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-2">
          <label className="block text-xs text-gray-400 font-medium">Authentication</label>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={authType} onChange={e => { setAuthType(e.target.value); setAuthSecret('') }}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500">
              <option value="none">No auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="apikey">API Key (header)</option>
              <option value="basic">Basic Auth</option>
            </select>
            {authType !== 'none' && (<>
              {authType === 'apikey' && (
                <input value={authKeyHeader} onChange={e => setAuthKeyHeader(e.target.value)} placeholder="Header name"
                  className="w-36 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500" />
              )}
              <select value={authSecret} onChange={e => setAuthSecret(e.target.value)}
                className="flex-1 min-w-32 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500">
                <option value="">— select secret —</option>
                {secrets.map(s => <option key={s.id} value={s.name}>{s.name}{s.description ? ` · ${s.description}` : ''}</option>)}
              </select>
              {authSecret && (
                <span className="text-xs text-gray-600 font-mono">
                  {authType === 'bearer' && `Authorization: Bearer {{secret:${authSecret}}}`}
                  {authType === 'basic'  && `Authorization: Basic {{secret:${authSecret}}}`}
                  {authType === 'apikey' && `${authKeyHeader}: {{secret:${authSecret}}}`}
                </span>
              )}
            </>)}
          </div>
          {authType === 'basic' && <p className="text-xs text-gray-600">Store credentials as <code>username:password</code> — Base64-encoded automatically.</p>}
          {secrets.length === 0 && authType !== 'none' && <p className="text-xs text-amber-600">No secrets stored yet. Add one in the Secrets section first.</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Additional Headers (JSON)<HelpTip text="Any extra HTTP headers beyond authentication, as a JSON object. The auth header above is added automatically." /></label>
            <textarea value={form.source_headers} onChange={e => set('source_headers', e.target.value)} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Body (JSON, POST only)<HelpTip text="Request body sent when method is POST, as a JSON object. Ignored for GET requests." /></label>
            <textarea value={form.source_body} onChange={e => set('source_body', e.target.value)} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-gray-400 font-medium">Pagination<HelpTip text="Fetch multiple pages from APIs that use page, offset, or cursor parameters. Item path is optional when the response itself is a list." /></label>
            <select value={form.pagination_type || 'none'} onChange={e => set('pagination_type', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
              {PAGINATION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          {form.pagination_type !== 'none' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Parameter name</label>
                <input value={form.pagination_param || ''} onChange={e => set('pagination_param', e.target.value)}
                  placeholder={form.pagination_type === 'cursor' ? 'cursor' : form.pagination_type === 'offset' ? 'offset' : 'page'}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Max pages</label>
                <input type="number" min="1" max="500" value={form.pagination_max_pages || 50} onChange={e => set('pagination_max_pages', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Items path</label>
                <input value={form.pagination_items_path || ''} onChange={e => set('pagination_items_path', e.target.value)}
                  placeholder="$.items"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              </div>
              {form.pagination_type === 'cursor' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Next cursor path</label>
                  <input value={form.pagination_path || ''} onChange={e => set('pagination_path', e.target.value)}
                    placeholder="$.next_cursor"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500" />
                </div>
              )}
            </div>
          )}
        </div>

        {previewError && <div className="p-3 bg-red-950 border border-red-800 rounded text-xs text-red-300">{previewError}</div>}
        {previewResult && (
          <div className="p-3 bg-gray-950 border border-gray-700 rounded space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-green-400">HTTP {previewResult.status_code}</span>
              <span className="text-xs text-gray-400">{previewResult.is_list ? `List of ${previewResult.total} items — showing first item` : 'Single object response'}</span>
              <span className="text-xs text-gray-600 ml-auto">{focusedRow !== null ? `Click a path to fill row ${focusedRow + 1}` : 'Click a path to add a new mapping'}</span>
            </div>
            <JsonTree data={previewResult.sample} onSelect={handlePathSelect} />
          </div>
        )}

        <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs text-gray-400 font-medium">Auto-fetch schedule<HelpTip text="Set a recurring schedule for automatic fetching. Choose an interval or a fixed time with specific days of the week." /></label>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer shrink-0">
              <input type="checkbox" checked={!!form.fetch_is_active} onChange={e => set('fetch_is_active', e.target.checked)} className="rounded border-gray-600" />
              Active
            </label>
          </div>
          <ScheduleBuilder value={form.fetch_cron || ''} onChange={v => set('fetch_cron', v)} />
        </div>
      </>)}

      <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-3">
        <label className="block text-xs text-gray-400 font-medium">Entry retention<HelpTip text="Optional safety limits for this blueprint. Pylo deletes the oldest entries first after fetches or manual entry creation." /></label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max entries</label>
            <input type="number" min="1" value={form.max_entries || ''} onChange={e => set('max_entries', e.target.value)}
              placeholder="No limit"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Retention days</label>
            <input type="number" min="1" value={form.retention_days || ''} onChange={e => set('retention_days', e.target.value)}
              placeholder="Keep forever"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
      </div>



      <div>
        <div className="flex items-center justify-between mb-1">
          <div>
            <label className="text-xs text-gray-400">Field Mappings<HelpTip text="Map JSONPath expressions from the API response to named fields. Use the Test button to browse the live response and click paths to fill rows." /></label>
            <span className="text-xs text-gray-600 ml-2">{previewResult && !form.is_manual ? 'Click a row to focus it, then click a path above' : 'Click ☆ to set the unique key for deduplication'}</span>
          </div>
          <button type="button" onClick={() => { setMappings(ms => [...ms, { ...EMPTY_MAPPING }]); setFocusedRow(mappings.length) }}
            className="text-xs text-indigo-400 hover:text-indigo-300">+ Add field</button>
        </div>
        {mappings.length > 0 && (
          <div className="grid grid-cols-12 gap-2 mb-1 px-1">
            <span className="col-span-1 text-xs text-gray-600 text-center flex items-center justify-center gap-0.5">Key<HelpTip text="Mark one field as the unique key. On each fetch, entries with the same key value are skipped (deduplication)." /></span>
            <span className="col-span-3 text-xs text-gray-600">JSONPath</span>
            <span className="col-span-3 text-xs text-gray-600">Field name</span>
            <span className="col-span-2 text-xs text-gray-600">Type</span>
            {form.mutable_mode === 'per_field' && <span className="col-span-1 text-xs text-gray-600 text-center">Edit</span>}
          </div>
        )}
        {mappings.length === 0 && <p className="text-xs text-gray-600 italic">No mappings — raw JSON will be stored only.</p>}
        <div className="space-y-1.5">
          {mappings.map((m, i) => (
            <div key={i} onClick={() => setFocusedRow(i)}
              className={"grid grid-cols-12 gap-2 items-center rounded p-0.5 cursor-pointer " + (focusedRow === i ? "bg-indigo-950/40 ring-1 ring-indigo-700" : "hover:bg-gray-900")}>
              <button type="button" onClick={e => { e.stopPropagation(); setKeyField(i) }}
                className={"col-span-1 flex items-center justify-center h-7 rounded text-sm transition-colors " + (m.is_key ? "text-yellow-400 bg-yellow-900/30 border border-yellow-700" : "text-gray-600 hover:text-gray-400 border border-transparent hover:border-gray-700")}>
                {m.is_key ? "★" : "☆"}
              </button>
              <input value={m.source_path} onChange={e => setMapping(i, 'source_path', e.target.value)} onClick={e => { e.stopPropagation(); setFocusedRow(i) }} placeholder="$.id"
                className={"col-span-3 bg-gray-800 border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 " + (m.is_key ? "border-yellow-800" : "border-gray-700")} />
              <input value={m.field_name} onChange={e => setMapping(i, 'field_name', e.target.value)} onClick={e => { e.stopPropagation(); setFocusedRow(i) }} placeholder={m.is_key ? "e.g. alert_id" : "field_name"}
                className={"col-span-3 bg-gray-800 border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 " + (m.is_key ? "border-yellow-800" : "border-gray-700")} />
              <select value={m.field_type} onChange={e => setMapping(i, 'field_type', e.target.value)}
                className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
                {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              {form.mutable_mode === 'per_field' && (
                <button type="button" onClick={e => { e.stopPropagation(); setMapping(i, 'mutable', !m.mutable) }}
                  title={m.mutable ? 'Editable by users' : 'Read-only'}
                  className={"col-span-1 flex items-center justify-center h-7 rounded text-xs transition-colors " + (m.mutable ? "text-green-400 bg-green-900/30 border border-green-700" : "text-gray-600 border border-transparent hover:border-gray-700")}>
                  {m.mutable ? '✏' : '–'}
                </button>
              )}
              <button type="button" onClick={e => { e.stopPropagation(); setMappings(ms => ms.filter((_, idx) => idx !== i)); if (focusedRow === i) setFocusedRow(null) }}
                className={"col-span-1 text-gray-600 hover:text-red-400 text-center text-sm " + (form.mutable_mode !== 'per_field' ? 'col-start-12' : '')}>×</button>
            </div>
          ))}
        </div>
        {mappings.length > 0 && !hasKey && <p className="text-xs text-amber-500 mt-2">No unique key set — duplicates may be created on repeated fetches. Click ☆ on the identifier field.</p>}
      </div>


      <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-400 font-medium">Entry mutability<HelpTip text="Controls whether entries can be edited after creation. 'None' is read-only. 'All fields' makes every field editable. 'Per field' lets you mark specific fields as editable." /></label>
          <select value={form.mutable_mode || 'none'} onChange={e => set('mutable_mode', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
            <option value="none">None (read-only)</option>
            <option value="all">All fields editable</option>
            <option value="per_field">Per field</option>
          </select>
        </div>
        {form.mutable_mode === 'per_field' && (
          <p className="text-xs text-gray-500">Toggle ✏ on each field above to mark it editable.</p>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}
