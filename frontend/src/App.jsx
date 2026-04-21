import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Blueprints from './pages/Blueprints'
import BlueprintDetail from './pages/BlueprintDetail'
import EntryDetail from './pages/EntryDetail'
import PyBooks from './pages/PyBooks'
import Runs from './pages/Runs'
import Secrets from './pages/Secrets'

function Placeholder({ title }) {
  return (
    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
      {title} — coming soon
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/blueprints" replace />} />
          <Route path="/objects" element={<Navigate to="/blueprints" replace />} />
          <Route path="/objects/*" element={<Navigate to="/blueprints" replace />} />
          <Route path="/blueprints" element={<Blueprints />} />
          <Route path="/blueprints/entries/:id" element={<EntryDetail />} />
          <Route path="/blueprints/:id" element={<BlueprintDetail />} />
          <Route path="/pybooks" element={<PyBooks />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/dashboards" element={<Placeholder title="Dashboards" />} />
          <Route path="/secrets" element={<Secrets />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
