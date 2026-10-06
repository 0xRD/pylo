import { useEffect, useState } from 'react'
import { runsApi } from '../api/pybooks'

// Run lists are fetched without stdout/stderr to keep them small. This hook
// loads the full run for display and merges it under the (fresher) list row.
export function useRunDetail(run) {
  const [detail, setDetail] = useState(null)
  const needsFetch = run?.id && run.stdout === undefined

  useEffect(() => {
    if (!needsFetch) return
    let cancelled = false
    runsApi.get(run.id).then(d => { if (!cancelled) setDetail(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [run?.id, run?.status, run?.ended_at, needsFetch])

  if (!run) return null
  if (!needsFetch) return run
  if (detail?.id !== run.id) return { ...run, stdout: '', stderr: '', _loading: true }
  return { ...detail, ...run, stdout: detail.stdout, stderr: detail.stderr }
}
