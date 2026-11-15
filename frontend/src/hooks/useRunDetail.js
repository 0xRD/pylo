import { useEffect, useState } from 'react'
import { runsApi } from '../api/pybooks'

const ACTIVE = new Set(['queued', 'pending', 'running'])

// Run lists are fetched without stdout/stderr to keep them small. This hook
// loads the full run for display and merges it under the (fresher) list row.
// While the run is active it keeps refreshing, so logs appear as they are written.
export function useRunDetail(run) {
  const [detail, setDetail] = useState(null)
  const needsFetch = run?.id && run.stdout === undefined
  // The polled detail can be ahead of a stale list row (e.g. right after a cancel).
  const current = detail?.id === run?.id ? detail : null
  const active = ACTIVE.has(run?.status) && (!current || ACTIVE.has(current.status))

  useEffect(() => {
    if (!needsFetch) return
    let cancelled = false
    const load = () => runsApi.get(run.id).then(d => { if (!cancelled) setDetail(d) }).catch(() => {})
    load()
    const timer = active ? setInterval(load, 1500) : null
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [run?.id, run?.status, run?.ended_at, needsFetch, active])

  if (!run) return null
  if (!needsFetch) return run
  if (detail?.id !== run.id) return { ...run, stdout: '', stderr: '', _loading: true }
  if (ACTIVE.has(run.status)) return { ...run, ...detail }
  return { ...detail, ...run, stdout: detail.stdout, stderr: detail.stderr }
}
