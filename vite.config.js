import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // honour the port the launcher assigns (autoPort) via the PORT env var; fall back to 5173
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    open: false,
  },
});
