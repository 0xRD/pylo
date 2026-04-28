import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Boxes,
  Braces,
  Clock3,
  Database,
  GitBranch,
  PlayCircle,
  RefreshCcw,
  ShieldCheck,
  Timer,
  Workflow,
} from 'lucide-react'
import { dashboardApi } from '../api/dashboard'
import { fmtDateTime } from '../utils/dates'

const STATUS_COLORS = {
  success: '#50fa7b',
  error: '#ff5555',
  timeout: '#ffb86c',
  running: '#8be9fd',
  queued: '#bd93f9',
  pending: '#6272a4',
}

function shortDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function numberFmt(value) {
  return new Intl.NumberFormat().format(value || 0)
}

function duration(ms) {
  if (!ms) return 'n/a'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StatTile({ icon: Icon, label, value, detail, tone = 'cyan', to }) {
  const color = tone === 'pink' ? 'text-[#ff79c6]' : tone === 'green' ? 'text-[#50fa7b]' : tone === 'orange' ? 'text-[#ffb86c]' : 'text-[#8be9fd]'
  const body = (
    <div className="rounded-lg border border-[#343746] bg-[#191a21] px-4 py-3 hover:border-[#6272a4] transition-colors min-h-[112px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-[#6272a4]">{label}</span>
        <Icon size={18} className={color} />
      </div>
      <div className="mt-3 text-3xl font-semibold text-[#f8f8f2]">{numberFmt(value)}</div>
      <div className="mt-1 text-xs text-[#a7abc4]">{detail}</div>
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <section className="rounded-lg border border-[#343746] bg-[#191a21]">
      <div className="flex items-center justify-between border-b border-[#343746] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[#f8f8f2]">
          {Icon && <Icon size={16} className="text-[#8be9fd]" />}
          {title}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function BarChart({ data, valueKey = 'count', color = '#8be9fd' }) {
  const max = Math.max(1, ...data.map(item => item[valueKey] || 0))
  return (
    <div className="h-56">
      <svg viewBox="0 0 640 220" className="h-full w-full" role="img" aria-label="Bar chart">
        <line x1="32" y1="180" x2="620" y2="180" stroke="#343746" />
        {data.map((item, index) => {
          const width = 520 / Math.max(data.length, 1)
          const x = 42 + index * (width + 4)
          const h = ((item[valueKey] || 0) / max) * 140
          return (
            <g key={item.date}>
              <rect x={x} y={180 - h} width={Math.max(8, width)} height={h} rx="3" fill={color} opacity="0.85" />
              {(index === 0 || index === data.length - 1 || data.length <= 7) && (
                <text x={x} y="204" fill="#6272a4" fontSize="11">{shortDate(item.date)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StackedRunChart({ data }) {
  const keys = ['success', 'error', 'timeout', 'running', 'queued', 'pending']
  const max = Math.max(1, ...data.map(item => item.total || 0))
  return (
    <div className="h-56">
      <svg viewBox="0 0 640 220" className="h-full w-full" role="img" aria-label="Runs by status chart">
        <line x1="32" y1="180" x2="620" y2="180" stroke="#343746" />
        {data.map((item, index) => {
          const width = 520 / Math.max(data.length, 1)
          const x = 42 + index * (width + 4)
          let y = 180
          return (
            <g key={item.date}>
              {keys.map(key => {
                const h = ((item[key] || 0) / max) * 140
                y -= h
                return <rect key={key} x={x} y={y} width={Math.max(8, width)} height={h} rx="2" fill={STATUS_COLORS[key]} opacity="0.9" />
              })}
              {(index === 0 || index === data.length - 1 || data.length <= 7) && (
                <text x={x} y="204" fill="#6272a4" fontSize="11">{shortDate(item.date)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LineChart({ data }) {
  const values = data.map(item => item.rate).filter(value => value != null)
  const points = data.map((item, index) => {
    const x = 42 + index * (540 / Math.max(data.length - 1, 1))
    const rate = item.rate == null ? 0 : item.rate
    const y = 180 - (rate / 100) * 140
    return `${x},${y}`
  }).join(' ')
  return (
    <div className="h-56">
      <svg viewBox="0 0 640 220" className="h-full w-full" role="img" aria-label="Success rate chart">
        <line x1="32" y1="180" x2="620" y2="180" stroke="#343746" />
        <line x1="32" y1="40" x2="620" y2="40" stroke="#343746" strokeDasharray="4 6" />
        <polyline fill="none" stroke="#50fa7b" strokeWidth="3" points={points} />
        {data.map((item, index) => {
          if (item.rate == null) return null
          const x = 42 + index * (540 / Math.max(data.length - 1, 1))
          const y = 180 - (item.rate / 100) * 140
          return <circle key={item.date} cx={x} cy={y} r="4" fill="#50fa7b" />
        })}
        <text x="34" y="34" fill="#6272a4" fontSize="11">100%</text>
        <text x="34" y="198" fill="#6272a4" fontSize="11">0%</text>
        {values.length === 0 && <text x="250" y="112" fill="#6272a4" fontSize="13">No completed runs yet</text>}
      </svg>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-md border border-dashed border-[#343746] px-4 py-8 text-center text-sm text-[#6272a4]">{text}</div>
}

export default function Dashboard() {
  const [days, setDays] = useState(14)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async (nextDays = days) => {
    setLoading(true)
    setError('')
    try {
      setData(await dashboardApi.summary(nextDays))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(days) }, [days])

  const combinedRuns = useMemo(() => {
    if (!data) return []
    return data.series.pybook_runs.map((item, index) => {
      const workflow = data.series.workflow_runs[index]
      const merged = { date: item.date, total: item.total + workflow.total }
      Object.keys(STATUS_COLORS).forEach(key => { merged[key] = (item[key] || 0) + (workflow[key] || 0) })
      return merged
    })
  }, [data])

  if (loading && !data) {
    return <div className="text-sm text-[#6272a4]">Loading dashboard...</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#f8f8f2]">Dashboard</h1>
          <p className="text-sm text-[#6272a4]">Operational snapshot across data, automations, and execution health.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[#343746] bg-[#191a21] p-1">
            {[7, 14, 30].map(option => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={`rounded px-3 py-1.5 text-sm transition-colors ${days === option ? 'bg-[#44475a] text-[#f8f8f2]' : 'text-[#a7abc4] hover:text-[#f8f8f2]'}`}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            onClick={() => load(days)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border border-[#343746] bg-[#191a21] px-3 py-2 text-sm text-[#a7abc4] hover:border-[#6272a4] hover:text-[#f8f8f2] disabled:opacity-50"
          >
            <RefreshCcw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-[#ff5555]/40 bg-[#ff5555]/10 px-4 py-3 text-sm text-[#ffb8b8]">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={Boxes} label="Blueprints" value={data.counts.blueprints} detail="Configured data sources" to="/blueprints" />
            <StatTile icon={Database} label="Entries" value={data.counts.entries} detail="Indexed records" tone="green" to="/entries" />
            <StatTile icon={Braces} label="PyBooks" value={data.counts.pybooks} detail={`${data.counts.active_pybooks} active`} tone="pink" to="/pybooks" />
            <StatTile icon={Workflow} label="Workflows" value={data.counts.workflows} detail={`${data.counts.active_workflows} active`} tone="orange" to="/workflows" />
            <StatTile icon={PlayCircle} label="Runs" value={data.counts.runs} detail={`Last ${data.days} days`} to="/runs" />
            <StatTile icon={Timer} label="Queue" value={data.queue.queued} detail={`${data.queue.running} running / ${data.queue.max_concurrent} slots`} tone="orange" to="/runs" />
            <StatTile icon={AlertTriangle} label="Failures" value={(data.status_totals.pybook.error || 0) + (data.status_totals.workflow.error || 0) + (data.status_totals.pybook.timeout || 0) + (data.status_totals.workflow.timeout || 0)} detail="Errors and timeouts" tone="pink" to="/runs" />
            <StatTile icon={Clock3} label="Retention" value={data.retention.deleted_entries} detail={`Deleted over ${data.days} days`} tone="green" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Entries created" icon={Database}>
              <BarChart data={data.series.entries} />
            </Panel>
            <Panel title="Runs by status" icon={PlayCircle}>
              <StackedRunChart data={combinedRuns} />
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#a7abc4]">
                {Object.entries(STATUS_COLORS).map(([status, color]) => (
                  <span key={status} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />{status}</span>
                ))}
              </div>
            </Panel>
            <Panel title="PyBook runs" icon={Braces}>
              <StackedRunChart data={data.series.pybook_runs} />
            </Panel>
            <Panel title="Success rate" icon={ShieldCheck}>
              <LineChart data={data.series.success_rate} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Recent failures" icon={AlertTriangle} action={<Link to="/runs" className="text-xs text-[#8be9fd] hover:text-[#bd93f9]">Runs</Link>}>
              {data.recent_failures.length === 0 ? <EmptyState text="No recent failed runs." /> : (
                <div className="space-y-2">
                  {data.recent_failures.map(run => (
                    <Link key={`${run.type}-${run.id}`} to="/runs" className="block rounded-md border border-[#343746] bg-[#282a36] px-3 py-2 hover:border-[#ff79c6]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-[#f8f8f2]">{run.owner_name}</span>
                        <span className="rounded bg-[#ff5555]/15 px-2 py-0.5 text-xs text-[#ffb8b8]">{run.status}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-[#6272a4]">
                        <span>{run.type} / {run.trigger_source}</span>
                        <span>{duration(run.duration_ms)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Top blueprints" icon={Boxes} action={<Link to="/blueprints" className="text-xs text-[#8be9fd] hover:text-[#bd93f9]">Blueprints</Link>}>
              {data.top_blueprints.length === 0 ? <EmptyState text="No entries indexed yet." /> : (
                <div className="space-y-3">
                  {data.top_blueprints.map(item => {
                    const max = Math.max(...data.top_blueprints.map(bp => bp.entries), 1)
                    return (
                      <Link key={item.id} to={`/blueprints/${item.id}`} className="block">
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-[#f8f8f2]">{item.name}</span>
                          <span className="text-[#a7abc4]">{numberFmt(item.entries)}</span>
                        </div>
                        <div className="h-2 rounded bg-[#282a36]"><div className="h-2 rounded bg-[#8be9fd]" style={{ width: `${Math.max(4, (item.entries / max) * 100)}%` }} /></div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Active automations" icon={GitBranch} action={<Link to="/automations" className="text-xs text-[#8be9fd] hover:text-[#bd93f9]">Automations</Link>}>
              <div className="grid grid-cols-3 gap-2">
                {['cron', 'webhook', 'blueprint'].map(type => (
                  <div key={type} className="rounded-md border border-[#343746] bg-[#282a36] p-3 text-center">
                    <div className="text-2xl font-semibold text-[#f8f8f2]">{numberFmt((data.automations.pybooks[type] || 0) + (data.automations.workflows[type] || 0))}</div>
                    <div className="mt-1 text-xs text-[#6272a4]">{type}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#a7abc4]">
                <div className="rounded-md bg-[#282a36] px-3 py-2">PyBooks: {numberFmt(Object.values(data.automations.pybooks).reduce((a, b) => a + b, 0))}</div>
                <div className="rounded-md bg-[#282a36] px-3 py-2">Workflows: {numberFmt(Object.values(data.automations.workflows).reduce((a, b) => a + b, 0))}</div>
              </div>
            </Panel>
          </div>

          <Panel title="Latest activity" icon={Activity} action={<Link to="/activity" className="text-xs text-[#8be9fd] hover:text-[#bd93f9]">Activity</Link>}>
            {data.activity.length === 0 ? <EmptyState text="No activity recorded yet." /> : (
              <div className="divide-y divide-[#343746]">
                {data.activity.map(event => (
                  <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-[#bd93f9]">{event.event_type}</span>
                      {event.resource_name && <span className="ml-2 text-[#f8f8f2]">{event.resource_name}</span>}
                      <span className="ml-2 text-xs text-[#6272a4]">by {event.actor}</span>
                    </div>
                    <span className="text-xs text-[#6272a4]">{fmtDateTime(event.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
