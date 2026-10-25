import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { blueprintsApi } from '../api/blueprints'
import BlueprintForm from '../components/BlueprintForm'
import { fmtDate } from '../utils/dates'
import { importApi, readImportFile } from '../api/exportImport'
import ImportConflictModal from '../components/ImportConflictModal'

function BlueprintCard({ blueprint, onClick }) {
  const isManual = blueprint.is_manual
  const hasCron  = blueprint.fetch_is_active && blueprint.fetch_cron

  return (
    <div onClick={onClick}
      className="bg-gray-900 border border-gray-800 rounded-lg p-5 cursor-pointer hover:border-indigo-500 transition-colors group">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-100 truncate group-hover:text-indigo-300 transition-colors">
            {blueprint.name}
          </h3>
          {blueprint.description && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{blueprint.description}</p>
          )}
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
          isManual ? 'bg-amber-900 text-amber-300' : 'bg-indigo-900 text-indigo-300'
        }`}>
          {isManual ? 'manual' : 'API'}
        </span>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {!isManual && blueprint.source_url && (
          <span className="text-xs text-gray-600 truncate max-w-48 font-mono">
            {blueprint.source_url}
          </span>
        )}
        {hasCron && (
          <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">
            ⏱ scheduled
          </span>
        )}
        <span className="text-xs text-gray-600 ml-auto">
          {fmtDate(blueprint.created_at)}
        </span>
      </div>
    </div>
  )
}

export default function Blueprints() {
  const [blueprints, setBlueprints] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [importConflicts, setImportConflicts] = useState(null)
  const [importData, setImportData] = useState(null)
  const [importError, setImportError] = useState(null)
  const importRef = useRef(null)
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const load = () => {
    setLoading(true)
    blueprintsApi.listBlueprints()
      .then(setBlueprints)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (data) => {
    const bp = await blueprintsApi.createBlueprint(data)
    setCreating(false)
    navigate(`/blueprints/${bp.id}`)
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const parsed = await readImportFile(file)
      if (parsed.pylo_export !== 'blueprint') { setImportError('This file is not a blueprint export.'); return }
      const res = await importApi.blueprint(parsed)
      if (!res.ok) { setImportData(parsed); setImportConflicts(res.conflicts) }
      else { load(); navigate(`/blueprints/${res.result.id}`) }
    } catch (err) { setImportError(err.message) }
  }

  const handleImportResolve = async ({ main, pybooks }) => {
    setImportError(null)
    try {
      const res = await importApi.blueprint(importData, main, pybooks)
      if (!res.ok) { setImportConflicts(res.conflicts) }
      else { setImportConflicts(null); setImportData(null); load(); navigate(`/blueprints/${res.result.id}`) }
    } catch (err) { setImportError(err.message); setImportConflicts(null) }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {importConflicts && (
        <ImportConflictModal
          conflicts={importConflicts}
          onResolve={handleImportResolve}
          onCancel={() => { setImportConflicts(null); setImportData(null) }}
        />
      )}
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Blueprints</h1>
          <p className="text-sm text-gray-500 mt-0.5">Data sources and schemas for your entries</p>
        </div>
        <div className="flex items-center gap-2">
          {importError && <span className="text-xs text-red-400">{importError}</span>}
          <button onClick={() => importRef.current?.click()} disabled={!isAdmin}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm text-sm font-medium transition-colors">
            Import
          </button>
          <button onClick={() => setCreating(true)} disabled={!isAdmin}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm text-sm font-medium transition-colors">
            + New Blueprint
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-16 text-center">Loading…</div>
      ) : blueprints.length === 0 && !creating ? (
        <div className="text-center py-24 text-gray-600">
          <p className="text-lg mb-2">No blueprints yet</p>
          <p className="text-sm mb-6">Blueprints define where data comes from and how to map it into entries.</p>
          <button onClick={() => setCreating(true)} disabled={!isAdmin}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm text-sm font-medium transition-colors">
            Create your first blueprint
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {blueprints.map(bp => (
            <BlueprintCard key={bp.id} blueprint={bp} onClick={() => navigate(`/blueprints/${bp.id}`)} />
          ))}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-12 px-4">
          <div className="w-full max-w-3xl bg-gray-950 border border-gray-800 rounded-xl p-8 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-100 mb-6">New Blueprint</h2>
            <BlueprintForm
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
