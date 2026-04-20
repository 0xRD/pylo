import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Objects from './pages/Objects'
import ObjectDetail from './pages/ObjectDetail'
import PyBooks from './pages/PyBooks'
import Runs from './pages/Runs'
import Secrets from './pages/Secrets'

function Placeholder({ title }) {
  return (
    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
      {title} — coming in Phase 3
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/objects" replace />} />
          <Route path="/objects" element={<Objects />} />
          <Route path="/objects/instances/:id" element={<ObjectDetail />} />
          <Route path="/pybooks" element={<PyBooks />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/dashboards" element={<Placeholder title="Dashboards" />} />
          <Route path="/secrets" element={<Secrets />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
