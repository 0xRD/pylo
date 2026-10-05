import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { GitopsProvider } from './context/GitopsContext'
import { UiProvider } from './context/UiContext'
import { authApi } from './api/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Setup from './pages/Setup'
import InviteAccept from './pages/InviteAccept'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Blueprints = lazy(() => import('./pages/Blueprints'))
const BlueprintDetail = lazy(() => import('./pages/BlueprintDetail'))
const EntryDetail = lazy(() => import('./pages/EntryDetail'))
const Entries = lazy(() => import('./pages/Entries'))
const PyBooks = lazy(() => import('./pages/PyBooks'))
const Runs = lazy(() => import('./pages/Runs'))
const Secrets = lazy(() => import('./pages/Secrets'))
const Settings = lazy(() => import('./pages/Settings'))
const Users = lazy(() => import('./pages/Users'))
const Activity = lazy(() => import('./pages/Activity'))
const Workflows = lazy(() => import('./pages/Workflows'))
const WorkflowEditor = lazy(() => import('./pages/WorkflowEditor'))
const Automations = lazy(() => import('./pages/Automations'))
const Wiki = lazy(() => import('./pages/Wiki'))

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
        <GitopsProvider>
        <UiProvider>
        <SetupGuard>
          <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/objects" element={<Navigate to="/blueprints" replace />} />
              <Route path="/objects/*" element={<Navigate to="/blueprints" replace />} />
              <Route path="/blueprints" element={<Blueprints />} />
              <Route path="/entries/:id" element={<EntryDetail />} />
              <Route path="/blueprints/entries/:id" element={<EntryDetail />} />
              <Route path="/blueprints/:id" element={<BlueprintDetail />} />
              <Route path="/entries" element={<Entries />} />
              <Route path="/pybooks" element={<PyBooks />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/automations" element={<Automations />} />
              <Route path="/secrets" element={<Secrets />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/wiki" element={<Wiki />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/workflows/:id" element={<WorkflowEditor />} />
              <Route path="/users" element={<Users />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
          </Suspense>
        </SetupGuard>
        </UiProvider>
        </GitopsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
