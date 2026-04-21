import { useNavigate } from 'react-router-dom'

export default function EntryCard({ entry, blueprintName, selected = false, onSelect }) {
  const navigate = useNavigate()
  let data = {}
  try { data = JSON.parse(entry.data) } catch {}

  const fields = Object.entries(data).slice(0, 4)

  const handleCardClick = () => {
    if (!onSelect) navigate(`/blueprints/entries/${entry.id}`)
  }

  return (
    <div
      onClick={handleCardClick}
      className={`relative bg-gray-900 border rounded-lg p-4 transition-colors group ${
        selected
          ? 'border-indigo-500 bg-indigo-950/20'
          : 'border-gray-800 hover:border-indigo-500 cursor-pointer'
      }`}
    >
      {onSelect && (
        <div
          className={`absolute top-3 right-3 z-10 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={e => { e.stopPropagation(); onSelect(entry.id) }}
        >
          <input type="checkbox" checked={selected} onChange={() => {}}
            className="w-4 h-4 cursor-pointer accent-indigo-500" />
        </div>
      )}

      <div className="flex items-center justify-between mb-2 pr-6">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-500 font-mono shrink-0">{entry.id.slice(0, 8)}</span>
          {blueprintName && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 truncate">{blueprintName}</span>
          )}
        </div>
        <span className="text-xs text-gray-500 shrink-0 ml-2">
          {new Date(entry.created_at).toLocaleDateString()}
        </span>
      </div>
      <dl className="space-y-1">
        {fields.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <dt className="text-gray-500 shrink-0">{k}:</dt>
            <dd className="text-gray-200 truncate">{String(v ?? '—')}</dd>
          </div>
        ))}
        {Object.keys(data).length === 0 && (
          <p className="text-gray-500 text-sm italic">No parsed fields</p>
        )}
      </dl>
    </div>
  )
}
