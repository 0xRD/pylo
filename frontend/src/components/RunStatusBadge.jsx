const STATUS_STYLES = {
  queued:   'bg-gray-800 text-gray-400',
  pending:  'bg-yellow-900 text-yellow-300',
  running:  'bg-blue-900 text-blue-300 animate-pulse',
  success:  'bg-green-900 text-green-300',
  error:    'bg-red-900 text-red-300',
  timeout:  'bg-orange-900 text-orange-300',
}

export default function RunStatusBadge({ status }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status] || 'bg-gray-800 text-gray-400'}`}>
      {status}
    </span>
  )
}
