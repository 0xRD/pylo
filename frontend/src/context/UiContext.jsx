import { createContext, useContext, useEffect, useState } from 'react'

const UiContext = createContext(null)

const FALLBACK = {
  sidebarCollapsed: false,
  density: 'comfortable',
  compact: false,
  toggleSidebar: () => {},
  setSidebarCollapsed: () => {},
  toggleDensity: () => {},
  setDensity: () => {},
}

function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

export function UiProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readStored('pylo:sidebarCollapsed', '0') === '1',
  )
  const [density, setDensity] = useState(
    () => (readStored('pylo:density', 'comfortable') === 'compact' ? 'compact' : 'comfortable'),
  )

  useEffect(() => {
    try {
      localStorage.setItem('pylo:sidebarCollapsed', sidebarCollapsed ? '1' : '0')
    } catch { /* ignore */ }
  }, [sidebarCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem('pylo:density', density)
    } catch { /* ignore */ }
  }, [density])

  const value = {
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar: () => setSidebarCollapsed(v => !v),
    density,
    setDensity,
    compact: density === 'compact',
    toggleDensity: () => setDensity(d => (d === 'compact' ? 'comfortable' : 'compact')),
  }

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

export function useUi() {
  return useContext(UiContext) ?? FALLBACK
}
