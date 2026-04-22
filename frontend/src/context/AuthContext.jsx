import { createContext, useContext, useEffect, useState } from 'react'
import { authApi } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading, null = not logged in

  useEffect(() => {
    authApi.me()
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  const login = async (username, password) => {
    const u = await authApi.login(username, password)
    setUser(u)
    return u
  }

  const logout = async () => {
    await authApi.logout()
    setUser(null)
  }

  const setup = async (username, password) => {
    const u = await authApi.setup(username, password)
    setUser(u)
    return u
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, setup, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
