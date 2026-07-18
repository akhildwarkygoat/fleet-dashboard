import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";

/* ── Dev-only endpoint that rebuilds the Prev-route data from the LIVE ERP ──────────
 * The "Prev. route" map (routes_map.html) POSTs /__rebuild_routes on load; this runs
 * refresh_routes.sh (fetch ERP → build_erp_routes.py, ~5 min) and streams progress via
 * /__rebuild_status, which the map's loading overlay polls. Only exists in `vite dev`,
 * so on Vercel the POST 404s and the map falls back to the committed snapshot. */
function routesRebuildPlugin() {
  let job = null; // { status:'running'|'done'|'error', message, pct, startedAt, finishedAt }
  const json = (res, obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
  return {
    name: "routes-rebuild",
    configureServer(server) {
      server.middlewares.use("/__rebuild_routes", (req, res, next) => {
        if (req.method !== "POST") return next();
        if (job && job.status === "running") return json(res, { status: "running", message: job.message, pct: job.pct });
        job = { status: "running", message: "Contacting ERP…", pct: 0, startedAt: Date.now() };
        let errTail = ""; // keep the last stderr so a failure reports WHY, not just "failed"
        const child = spawn("bash", ["refresh_routes.sh"], { cwd: process.cwd(), env: process.env });
        const onData = (buf) => {
          const s = buf.toString();
          const busMatches = s.match(/routing bus (\d+)\/(\d+)/g);
          if (busMatches) {
            const last = busMatches[busMatches.length - 1].match(/(\d+)\/(\d+)/);
            job.pct = Math.round((+last[1] / +last[2]) * 100);
            job.message = `Routing bus ${last[1]} / ${last[2]}…`;
          } else if (/Fetching live ERP/.test(s)) { job.message = "Fetching live ERP feed…"; job.pct = 0; }
          else if (/rows, latest/.test(s)) { job.message = "ERP received · clustering stops…"; job.pct = 2; }
          else if (/Rebuilding routes/.test(s)) { job.message = "Building road paths…"; job.pct = 4; }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", (buf) => { onData(buf); errTail = (errTail + buf.toString()).slice(-400); });
        child.on("close", (code) => {
          const reason = errTail.split("\n").map((l) => l.trim()).filter(Boolean).pop();
          job = code === 0
            ? { status: "done", message: "Routes updated", pct: 100, startedAt: job.startedAt, finishedAt: Date.now() }
            : { status: "error", code, message: "Rebuild failed" + (reason ? ` — ${reason}` : ""), detail: errTail, pct: 100, startedAt: job.startedAt, finishedAt: Date.now() };
        });
        child.on("error", (e) => { job = { status: "error", message: "Could not start rebuild — " + (e.code === "ENOENT" ? "'bash' not found (on Windows, run via Git Bash/WSL)" : e.message), pct: 100 }; });
        json(res, { status: "running", message: job.message, pct: job.pct });
      });
      server.middlewares.use("/__rebuild_status", (req, res) => json(res, job || { status: "idle" }));
    },
  };
}

export default defineConfig({
  plugins: [react(), routesRebuildPlugin()],
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
