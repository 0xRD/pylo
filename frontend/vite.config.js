import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Backend for the dev-server proxy; defaults to the Compose service name.
const backend = process.env.PYLO_BACKEND_URL || "http://backend:8000"

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
        ws: true,
      },
      "/health": {
        target: backend,
        changeOrigin: true,
      },
    },
  },
})
