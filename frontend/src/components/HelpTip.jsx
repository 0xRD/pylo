export default function HelpTip({ text }) {
  return (
    <span className="relative group inline-flex items-center ml-1 align-middle">
      <span className="w-3.5 h-3.5 rounded-full bg-gray-700 text-gray-400 text-[9px] font-bold flex items-center justify-center cursor-default select-none hover:bg-gray-600 hover:text-gray-200 transition-colors">?</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-sm text-xs text-gray-300 leading-relaxed pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
      </span>
    </span>
  )
}
