import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

const TYPE_LABELS = { workflow: 'Workflow', pybook: 'PyBook', blueprint: 'Blueprint' }

// conflicts: array of { key, name, type, existing_id }
// onResolve(resolutions): called with { main: "update"|"rename", pybooks: { name: "update"|"rename" } }
// onCancel(): called when the user cancels
export default function ImportConflictModal({ conflicts, onResolve, onCancel }) {
  const mainConflict = conflicts.find(c => c.key === 'main')
  const pbConflicts = conflicts.filter(c => c.key !== 'main')

  const [mainRes, setMainRes] = useState(mainConflict ? 'update' : null)
  const [pbRes, setPbRes] = useState(() =>
    Object.fromEntries(pbConflicts.map(c => [c.name, 'update']))
  )

  const handleProceed = () => {
    onResolve({
      main: mainRes,
      pybooks: pbRes,
    })
  }

  const Row = ({ label, name, value, onChange }) => (
    <div className="p-3 bg-gray-800 rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
        <span className="text-xs text-gray-300">
          <span className="text-yellow-300 font-medium">{label}</span>
          {' '}
          <span className="font-semibold text-gray-100">"{name}"</span>
          {' '}already exists.
        </span>
      </div>
      <div className="flex gap-2 pl-5">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" value="update" checked={value === 'update'} onChange={() => onChange('update')}
            className="accent-indigo-500" />
          <span className="text-xs text-gray-300">Update existing</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" value="rename" checked={value === 'rename'} onChange={() => onChange('rename')}
            className="accent-indigo-500" />
          <span className="text-xs text-gray-300">Rename existing <span className="text-gray-500">(keeps old as "… (pre-import)")</span></span>
        </label>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg bg-gray-950 border border-gray-700 rounded-xl shadow-2xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-gray-100">Import conflicts</h2>
        <p className="text-xs text-gray-400">
          The following objects already exist. Choose how to handle each one.
        </p>

        <div className="space-y-2">
          {mainConflict && (
            <Row
              label={TYPE_LABELS[mainConflict.type] ?? mainConflict.type}
              name={mainConflict.name}
              value={mainRes}
              onChange={setMainRes}
            />
          )}
          {pbConflicts.map(c => (
            <Row
              key={c.key}
              label="PyBook"
              name={c.name}
              value={pbRes[c.name] ?? 'update'}
              onChange={v => setPbRes(prev => ({ ...prev, [c.name]: v }))}
            />
          ))}
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button onClick={handleProceed}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition-colors">
            Proceed
          </button>
        </div>
      </div>
    </div>
  )
}
