import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { authApi } from './api/auth'
import Layout from './components/Layout'
import Blueprints from './pages/Blueprints'
import BlueprintDetail from './pages/BlueprintDetail'
import EntryDetail from './pages/EntryDetail'
import Entries from './pages/Entries'
import PyBooks from './pages/PyBooks'
import Runs from './pages/Runs'
import Secrets from './pages/Secrets'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Activity from './pages/Activity'
import InviteAccept from './pages/InviteAccept'
import Workflows from './pages/Workflows'
import WorkflowEditor from './pages/WorkflowEditor'

function SetupGuard({ children }) {
  const [setupRequired, setSetupRequired] = useState(undefined)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    authApi.setupStatus().then(({ required }) => {
      setSetupRequired(required)
      if (required && location.pathname !== '/setup') navigate('/setup', { replace: true })
      if (!required && location.pathname === '/setup') navigate('/login', { replace: true })
    }).catch(() => {})
  }, [])

  if (setupRequired === undefined) return null // loading
  return children
}

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (user === undefined) return null // loading
  if (user === null) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SetupGuard>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
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
              <Route path="/activity" element={<Activity />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/workflows/:id" element={<WorkflowEditor />} />
              <Route path="/users" element={<Users />} />
            </Route>
          </Routes>
        </SetupGuard>
      </AuthProvider>
    </BrowserRouter>
  )
}
