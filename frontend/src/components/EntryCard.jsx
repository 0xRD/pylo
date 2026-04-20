import { useNavigate } from 'react-router-dom'

export default function EntryCard({ entry }) {
  const navigate = useNavigate()
  let data = {}
  try { data = JSON.parse(entry.data) } catch {}

  const fields = Object.entries(data).slice(0, 4)

  return (
    <div
      onClick={() => navigate(`/blueprints/entries/${entry.id}`)}
      className="bg-gray-900 border border-gray-800 rounded-lg p-4 cursor-pointer hover:border-indigo-500 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-mono truncate">{entry.id.slice(0, 8)}</span>
        <span className="text-xs text-gray-500">
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
