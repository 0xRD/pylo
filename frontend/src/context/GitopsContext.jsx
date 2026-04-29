import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getGitStatus } from "../api/gitops";
import { useAuth } from "./AuthContext";

const GitopsContext = createContext(null);

export function GitopsProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState({
    environment: "dev",
    configured: false,
    pending_count: 0,
    remote_ahead: false,
  });
  const timerRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!user) return;
    try {
      const s = await getGitStatus();
      setStatus(s);
    } catch (_) {
      // silently ignore — user may not be admin or git may not be configured
    }
  }, [user]);

  useEffect(() => {
    refetch();
    // Poll every 60 seconds
    timerRef.current = setInterval(refetch, 60_000);
    return () => clearInterval(timerRef.current);
  }, [refetch]);

  const env = status.environment || "dev";
  const value = {
    environment: env,
    isProd: env === "prod",
    isDev: env === "dev",
    configured: status.configured,
    pendingCount: status.pending_count || 0,
    remoteAhead: status.remote_ahead || false,
    refetch,
  };

  return <GitopsContext.Provider value={value}>{children}</GitopsContext.Provider>;
}

export function useGitops() {
  const ctx = useContext(GitopsContext);
  if (!ctx) throw new Error("useGitops must be used inside GitopsProvider");
  return ctx;
}
