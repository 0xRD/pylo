import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#0f1117] text-[#f8f8f2] overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 bg-[radial-gradient(circle_at_top_right,rgba(189,147,249,0.10),transparent_34%),linear-gradient(180deg,#12141c_0%,#0f1117_100%)]">
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
