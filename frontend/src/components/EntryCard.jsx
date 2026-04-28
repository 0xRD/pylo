import { useNavigate } from 'react-router-dom'
import { fmtDate } from '../utils/dates'

export default function EntryCard({ entry, blueprintName, selected = false, onSelect }) {
  const navigate = useNavigate()
  let data = {}
  try { data = JSON.parse(entry.data) } catch {}

  const fields = Object.entries(data)

  const handleCardClick = () => {
    navigate(`/entries/${entry.id}`)
  }

  return (
    <div
      onClick={handleCardClick}
      className={`relative bg-[#191a21]/95 border rounded-md p-4 transition-colors group shadow-lg shadow-black/10 ${
        selected
          ? 'border-[#bd93f9] bg-[#282a36]'
          : 'border-[#343746] hover:border-[#6272a4] cursor-pointer'
      }`}
    >
      {onSelect && (
        <div
          className={`absolute top-3 right-3 z-10 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={e => { e.stopPropagation(); onSelect(entry.id) }}
        >
          <input type="checkbox" checked={selected} onChange={() => {}}
            className="w-4 h-4 cursor-pointer accent-[#bd93f9]" />
        </div>
      )}

      <div className="flex items-center justify-between mb-2 pr-6">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-[#6272a4] font-mono shrink-0">{entry.id.slice(0, 8)}</span>
          {blueprintName && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#282a36] text-[#8be9fd] truncate">{blueprintName}</span>
          )}
        </div>
        <span className="text-xs text-[#6272a4] shrink-0 ml-2">
          {fmtDate(entry.created_at)}
        </span>
      </div>
      <dl className="space-y-1">
        {fields.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <dt className="text-[#6272a4] shrink-0">{k}:</dt>
            <dd className="text-[#f8f8f2] truncate">{String(v ?? '—')}</dd>
          </div>
        ))}
        {Object.keys(data).length === 0 && (
          <p className="text-[#6272a4] text-sm italic">No parsed fields</p>
        )}
      </dl>
    </div>
  )
}
