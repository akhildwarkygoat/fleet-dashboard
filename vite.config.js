import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // honour the port the launcher assigns (autoPort) via the PORT env var; fall back to 5173
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    open: false,
    // Dev proxy for the ERP feed — the browser calls /erp/... same-origin and Vite
    // forwards it to the on-prem ERP, sidestepping CORS / mixed-content. Prod should
    // route the same /erp path through the backend (Laravel Http::post passthrough).
    proxy: {
      "/erp": {
        target: "http://172.16.10.169:8089",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/erp/, "/api"),
      },
    },
  },
});
