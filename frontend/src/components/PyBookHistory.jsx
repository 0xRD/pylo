import { useEffect, useState } from 'react'
import { GitCommitHorizontal, History, RotateCcw, X } from 'lucide-react'
import { CodeDiff } from './CodeEditor'
import { pybooksApi } from '../api/pybooks'
import { fmtDateTime, parseUTC } from '../utils/dates'

export function timeAgo(iso) {
  const d = parseUTC(iso)
  if (!d) return ''
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return d.toLocaleDateString()
}

function DiffStat({ additions, deletions }) {
  return (
    <span className="font-mono text-[11px]">
      <span className="text-[#50fa7b]">+{additions}</span>{' '}
      <span className="text-[#ff5555]">−{deletions}</span>
    </span>
  )
}

/** GitLab-style commit timeline for a PyBook script. */
export function HistoryPanel({ versions, loading, activeVersion, onSelect, onClose }) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-[#343746] bg-[#151720]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#343746] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-[#ffb86c]" />
          History
          <span className="text-xs font-normal text-[#6272a4]">{versions.length} versions</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-[#6272a4] hover:bg-[#282a36] hover:text-[#f8f8f2]" title="Close history">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {loading && versions.length === 0 && <p className="px-4 text-xs italic text-[#6272a4]">Loading…</p>}
        {versions.map((v, i) => {
          const active = activeVersion === v.version
          return (
            <button key={v.version} onClick={() => onSelect(v.version)}
              className={'group relative flex w-full gap-3 px-4 py-2.5 text-left transition-colors ' + (active ? 'bg-[#282a36]' : 'hover:bg-[#20222c]')}>
              {/* timeline rail */}
              <div className="relative flex w-4 shrink-0 justify-center">
                {i < versions.length - 1 && <span className="absolute top-5 bottom-[-14px] w-px bg-[#343746]" />}
                <GitCommitHorizontal className={'relative mt-0.5 h-4 w-4 ' + (i === 0 ? 'text-[#50fa7b]' : active ? 'text-[#bd93f9]' : 'text-[#6272a4]')} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[#f8f8f2]" title={v.message}>{v.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#6272a4]">
                  <span className="rounded bg-[#343746] px-1.5 font-mono text-[#8be9fd]">v{v.version}</span>
                  {i === 0 && <span className="rounded bg-[#50fa7b]/15 px-1.5 text-[#50fa7b]">current</span>}
                  <span className="truncate">{v.author}</span>
                  <span title={fmtDateTime(v.created_at)}>{timeAgo(v.created_at)}</span>
                  <DiffStat additions={v.additions} deletions={v.deletions} />
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <p className="shrink-0 border-t border-[#343746] px-4 py-2 text-[11px] text-[#6272a4]">
        A version is recorded each time the script is saved, restored, imported or synced.
      </p>
    </aside>
  )
}

/** Replaces the editor while a version is selected: diff + restore. */
export function VersionDiffView({ pybookId, version, versions, currentScript, canRestore, onRestore, onClose }) {
  const [mode, setMode] = useState('changes') // 'changes' (vs previous) | 'current' (vs editor)
  const [inline, setInline] = useState(false)
  const [scripts, setScripts] = useState({})
  const [error, setError] = useState('')
  const meta = versions.find(v => v.version === version)
  const previous = version > 1 ? version - 1 : null

  useEffect(() => {
    setError('')
    const wanted = [version, previous].filter(n => n && scripts[n] === undefined)
    Promise.all(wanted.map(n => pybooksApi.getVersion(pybookId, n).then(v => [n, v.script])))
      .then(entries => entries.length && setScripts(s => ({ ...s, ...Object.fromEntries(entries) })))
      .catch(e => setError(e.message))
  }, [pybookId, version])

  const selected = scripts[version]
  const loaded = selected !== undefined && (mode === 'current' || !previous || scripts[previous] !== undefined)
  const original = mode === 'changes' ? (previous ? scripts[previous] : '') : selected
  const modified = mode === 'changes' ? selected : currentScript

  const tab = (value, label) => (
    <button onClick={() => setMode(value)}
      className={'rounded px-2.5 py-1 text-xs transition-colors ' + (mode === value ? 'bg-[#44475a] text-[#8be9fd]' : 'text-[#8b8fa3] hover:bg-[#282a36]')}>
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#343746] bg-[#20222c] px-5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#f8f8f2]">
            <span className="mr-2 rounded bg-[#343746] px-1.5 font-mono text-xs text-[#8be9fd]">v{version}</span>
            {meta?.message}
          </p>
          {meta && (
            <p className="mt-0.5 text-[11px] text-[#6272a4]">
              {meta.author} · {fmtDateTime(meta.created_at)} · <DiffStat additions={meta.additions} deletions={meta.deletions} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 rounded bg-[#191a21] p-0.5">
          {tab('changes', previous ? `Changes since v${previous}` : 'Initial content')}
          {tab('current', 'Compare with editor')}
        </div>
        <button onClick={() => setInline(v => !v)} className="rounded bg-[#282a36] px-2.5 py-1 text-xs text-[#8b8fa3] hover:bg-[#343746]">
          {inline ? 'Side by side' : 'Inline'}
        </button>
        {canRestore && (
          <button onClick={() => onRestore(version)}
            className="inline-flex items-center gap-1.5 rounded bg-[#ffb86c] px-2.5 py-1 text-xs font-semibold text-[#191a21] hover:bg-[#ffc98f]">
            <RotateCcw className="h-3.5 w-3.5" /> Restore this version
          </button>
        )}
        <button onClick={onClose} className="rounded p-1 text-[#6272a4] hover:bg-[#282a36] hover:text-[#f8f8f2]" title="Back to editor">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {error && <p className="p-4 text-xs text-[#ff5555]">{error}</p>}
        {!error && !loaded && <p className="p-4 text-xs italic text-[#6272a4]">Loading version…</p>}
        {!error && loaded && <CodeDiff key={`${version}-${mode}-${inline}`} original={original} modified={modified} inline={inline} />}
      </div>
    </div>
  )
}
