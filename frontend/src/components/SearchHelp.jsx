import { useState, useRef } from 'react'

const FTS_ROWS = [
  { ex: 'mimikatz lolbas',     desc: 'Implicit AND (both terms)' },
  { ex: 'mimikatz OR lolbas',  desc: 'Either term' },
  { ex: 'mimikatz NOT lolbas', desc: 'Exclude second term' },
  { ex: '"cmd.exe /c"',        desc: 'Exact phrase' },
  { ex: 'exec*',               desc: 'Prefix match' },
]

const FIELD_ROWS = [
  { ex: 'external_id = CVE-2024',         desc: 'Exact field match' },
  { ex: 'name contains shell',            desc: 'Partial field match' },
  { ex: 'os != Windows',                  desc: 'Field not equal' },
  { ex: 'os = Windows OR os = Linux',     desc: 'OR between filters' },
  { ex: 'os = Windows AND exec*',         desc: 'Field filter + full-text' },
]

function Section({ title, rows }) {
  return (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mt-2 mb-1 first:mt-0">{title}</p>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map(({ ex, desc }) => (
            <tr key={ex} className="border-t border-gray-800 first:border-0">
              <td className="py-0.5 pr-3 font-mono text-indigo-300 whitespace-nowrap">{ex}</td>
              <td className="py-0.5 text-gray-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const TOOLTIP_HEIGHT = 290

export default function SearchHelp() {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const ref = useRef(null)

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setAbove(rect.top > TOOLTIP_HEIGHT)
    }
    setOpen(true)
  }

  return (
    <span
      ref={ref}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setOpen(false)}
      className="relative inline-flex items-center shrink-0"
    >
      <span className="w-4 h-4 rounded-full bg-gray-700 text-gray-400 text-[9px] font-bold flex items-center justify-center cursor-default select-none hover:bg-gray-600 hover:text-gray-200 transition-colors">
        ?
      </span>
      {open && (
        <span className={`absolute right-0 w-96 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 z-50 shadow-xl ${
          above ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}>
          <Section title="Full-text search" rows={FTS_ROWS} />
          <Section title="Field filters" rows={FIELD_ROWS} />
          <span className={`absolute right-3 border-4 border-transparent ${
            above ? 'top-full border-t-gray-700' : 'bottom-full border-b-gray-700'
          }`} />
        </span>
      )}
    </span>
  )
}
