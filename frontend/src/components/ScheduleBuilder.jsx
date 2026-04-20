import { useEffect, useState } from 'react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_CRON = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }

function toCron(mode, interval, unit, time, days) {
  if (mode === 'interval') {
    const n = parseInt(interval) || 1
    if (unit === 'minutes') return `*/${n} * * * *`
    if (unit === 'hours')   return `0 */${n} * * *`
    if (unit === 'days')    return `0 0 */${n} * *`
  }
  if (mode === 'scheduled') {
    const [hh, mm] = (time || '09:00').split(':')
    const dayPart = days.length === 0 || days.length === 7
      ? '*'
      : days.map(d => DAY_CRON[d]).sort((a, b) => a - b).join(',')
    return `${parseInt(mm)} ${parseInt(hh)} * * ${dayPart}`
  }
  return ''
}

function fromCron(cron) {
  if (!cron) return { mode: 'interval', interval: '5', unit: 'minutes', time: '09:00', days: [] }
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { mode: 'interval', interval: '5', unit: 'minutes', time: '09:00', days: [] }
  const [min, hour, dom, , dow] = parts
  if (min.startsWith('*/') && hour === '*') return { mode: 'interval', interval: min.slice(2), unit: 'minutes', time: '09:00', days: [] }
  if (min === '0' && hour.startsWith('*/')) return { mode: 'interval', interval: hour.slice(2), unit: 'hours', time: '09:00', days: [] }
  if (min === '0' && hour === '0' && dom.startsWith('*/')) return { mode: 'interval', interval: dom.slice(2), unit: 'days', time: '09:00', days: [] }
  // scheduled
  const hh = hour.padStart(2, '0')
  const mm = min.padStart(2, '0')
  const activeDays = dow === '*' ? [] : dow.split(',').map(n => Object.keys(DAY_CRON).find(k => DAY_CRON[k] === parseInt(n))).filter(Boolean)
  return { mode: 'scheduled', interval: '5', unit: 'minutes', time: `${hh}:${mm}`, days: activeDays }
}

export default function ScheduleBuilder({ value, onChange }) {
  const parsed = fromCron(value)
  const [mode, setMode] = useState(parsed.mode)
  const [interval, setInterval] = useState(parsed.interval)
  const [unit, setUnit] = useState(parsed.unit)
  const [time, setTime] = useState(parsed.time)
  const [days, setDays] = useState(parsed.days)

  const cron = toCron(mode, interval, unit, time, days)

  useEffect(() => { onChange(cron) }, [mode, interval, unit, time, days])

  const toggleDay = (d) => setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d])

  return (
    <div className="space-y-2">
      <div className="flex rounded overflow-hidden border border-gray-700 w-fit text-xs">
        {['interval', 'scheduled'].map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={"px-3 py-1.5 transition-colors " + (mode === m ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700")}>
            {m === 'interval' ? 'Every…' : 'At a time'}
          </button>
        ))}
      </div>

      {mode === 'interval' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Every</span>
          <input type="number" min="1" value={interval} onChange={e => setInterval(e.target.value)}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:border-indigo-500" />
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500">
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}

      {mode === 'scheduled' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">At</span>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400">On</span>
            {DAYS.map(d => (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={"px-2 py-0.5 rounded text-xs border transition-colors " +
                  (days.includes(d)
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500")}>
                {d}
              </button>
            ))}
            <span className="text-xs text-gray-600 ml-1">{days.length === 0 ? '(every day)' : ''}</span>
          </div>
        </div>
      )}

      {cron && <p className="text-xs text-gray-600 font-mono">→ {cron}</p>}
    </div>
  )
}
