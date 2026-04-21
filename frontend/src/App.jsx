import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Blueprints from './pages/Blueprints'
import BlueprintDetail from './pages/BlueprintDetail'
import EntryDetail from './pages/EntryDetail'
import Entries from './pages/Entries'
import PyBooks from './pages/PyBooks'
import Runs from './pages/Runs'
import Secrets from './pages/Secrets'
import Settings from './pages/Settings'

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
          <Route path="/entries" element={<Entries />} />
          <Route path="/pybooks" element={<PyBooks />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/secrets" element={<Secrets />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
