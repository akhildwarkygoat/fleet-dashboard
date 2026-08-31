import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

/* ── ERP login ────────────────────────────────────────────────────────────────────
 * The ERP is no longer open: POST /api/login with a username and password returns a
 * bearer token, and every /api/general/* call has to carry it.
 *
 * The credentials are read HERE, in the dev server, and never reach the browser — the
 * proxy attaches the header as the request passes through. Putting them in the React
 * app instead would ship the ERP password to every machine that opens the dashboard,
 * where anyone could read it out of the bundle.
 *
 * Supply them either way (see README):
 *   ERP_USER / ERP_PASS   environment variables, or
 *   .erp_key              {"Username": "…", "password": "…"} — gitignored, same rule
 *                         as .maps_key: never committed, never printed. Either casing
 *                         is accepted, since the ERP was documented to us both ways.
 *
 * With neither, requests go out unauthenticated exactly as before, so a site still on
 * the old open ERP keeps working and the startup log says which mode is in use.
 *
 * PRODUCTION: the backend passthrough has to do this same login. The browser cannot,
 * for the same reason it cannot hold the password. */
/* The ERP has SPLIT-HORIZON DNS. On the office LAN, life.gainup.in resolves to the internal
   172.16.10.169; from anywhere else it resolves to the public 203.101.97.26. The old comment
   here claimed the hostname "works from either side" — it does not. A machine on a different
   office subnet (e.g. 172.16.97.x) is handed the internal address and cannot route to it, so
   the dashboard dies with ETIMEDOUT on the office wifi while working fine on a phone hotspot.

   So don't trust one address: try each candidate's TCP port and use the first that answers.
   ERP_BASE still wins outright when set, for a site whose ERP lives somewhere else. */
let ERP_BASE = process.env.ERP_BASE || "http://life.gainup.in:8089";

const ERP_CANDIDATES = [
  process.env.ERP_BASE,
  "http://life.gainup.in:8089",   // correct on the hotspot / from home; internal-only in some offices
  "http://203.101.97.26:8089",    // the public address the hostname resolves to outside
].filter(Boolean);

/** Resolves once at dev-server startup. ~2.5 s worst case per dead candidate. */
function tcpProbe(host, port, ms = 2500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(ms);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

async function resolveErpBase(logger) {
  for (const base of ERP_CANDIDATES) {
    const u = new URL(base);
    if (await tcpProbe(u.hostname, Number(u.port) || 80)) {
      if (base !== ERP_CANDIDATES[0] || ERP_CANDIDATES.length === 1) { /* fallthrough */ }
      return base;
    }
    logger && logger.info(`  ERP   ${u.hostname}:${u.port} did not answer — trying the next address`);
  }
  return ERP_CANDIDATES[0];
}

function erpCredentials() {
  if (process.env.ERP_USER && process.env.ERP_PASS)
    return { user: process.env.ERP_USER, pass: process.env.ERP_PASS };
  try {
    // strip a UTF-8 BOM: PowerShell's Set-Content/Out-File writes one by default, and
    // JSON.parse throws on it — an unhelpful failure for the Windows machines this runs on
    const raw = JSON.parse(fs.readFileSync(".erp_key", "utf8").replace(/^﻿/, ""));
    // the ERP's own two descriptions of this API disagree on casing, so accept either
    const user = raw.Username || raw.UserName || raw.username || raw.user;
    const pass = raw.Password || raw.password || raw.pass;
    if (user && pass) return { user, pass };
  } catch { /* no file, or not JSON — treated as "no credentials" */ }
  return null;
}

/* The ERP was documented to us twice with different casing — {"Username", "password"} in
   the email, {"UserName", "Password"} in the Postman screenshot. Most .NET endpoints bind
   case-insensitively and would take either, but we can't verify which this one does without
   a live login, so try the emailed shape first and fall back to the other. Whichever works
   is logged, so this stops being guesswork the first time anyone runs it. */
const LOGIN_SHAPES = [
  { label: 'Username/password', body: (c) => ({ Username: c.user, password: c.pass }) },
  { label: 'UserName/Password', body: (c) => ({ UserName: c.user, Password: c.pass }) },
];

/* One token, reused. Re-logging in per request would turn every 30-minute sync into two
   round trips and hammer the login endpoint; `inflight` collapses the burst of calls the
   dashboard makes on load into a single login. */
let erpToken = null, erpTokenAt = 0, erpLogin = null, erpShape = "";
const TOKEN_TTL_MS = 20 * 60 * 1000;   // re-login well inside any plausible expiry

async function ensureErpToken(force = false) {
  const creds = erpCredentials();
  if (!creds) return null;
  if (!force && erpToken && Date.now() - erpTokenAt < TOKEN_TTL_MS) return erpToken;
  if (erpLogin) return erpLogin;
  erpLogin = (async () => {
    let last = "";
    for (const shape of LOGIN_SHAPES) {
      const res = await fetch(ERP_BASE + "/API/LOGIN", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(shape.body(creds)),
      });
      if (!res.ok) { last = `HTTP ${res.status} for ${shape.label}`; continue; }
      const body = await res.json().catch(() => null);
      // the documented shape is {"token": "…"}; the others cost nothing and save a
      // debugging session if the ERP is ever changed to wrap or rename it
      const t = body && (body.token || body.Token || body.access_token ||
                         (body.data && (body.data.token || body.data.Token)));
      if (!t) { last = `${shape.label} was accepted but no token came back`; continue; }
      erpToken = String(t); erpTokenAt = Date.now();
      erpShape = shape.label;
      return erpToken;
    }
    throw new Error(last || "login failed");
  })().finally(() => { erpLogin = null; });
  return erpLogin;
}

/* Fetches the token before the proxy forwards anything. Registered in configureServer
   without returning a function, so it runs BEFORE Vite's own proxy middleware. */
function erpAuthPlugin() {
  return {
    name: "erp-auth",
    configureServer(server) {
      const has = !!erpCredentials();
      server.config.logger.info(has
        ? "  ERP   login configured — requests will carry a bearer token"
        : "  ERP   no credentials (.erp_key or ERP_USER/ERP_PASS) — calling the ERP unauthenticated");
      server.config.logger.info(`  ERP   using ${ERP_BASE}`);
      // Log in at startup rather than waiting for the first request. It means the token is
      // already warm when the dashboard opens, and — the reason it matters — a wrong password
      // is reported here, in the window the user is looking at, instead of surfacing later as
      // a generic "ERP sync failed" inside the app.
      if (has) {
        ensureErpToken()
          .then(() => server.config.logger.info(`  ERP   logged in (${erpShape})`))
          .catch((e) => server.config.logger.error("  ERP   login failed — " + e.message));
      }
      server.middlewares.use("/erp", async (req, res, next) => {
        try {
          await ensureErpToken();
        } catch (e) {
          // Don't fail the request here. The ERP answers unauthenticated calls with a
          // 401 the dashboard already surfaces as "ERP sync failed"; swallowing the
          // login error and letting that happen keeps one error path, not two.
          server.config.logger.error("  ERP   login failed — " + e.message);
        }
        next();
      });
    },
  };
}

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

/* async: the proxy's `target` is read once when this object is built, so the reachable ERP
   address has to be settled before that — not inside configureServer, which runs later. */
export default defineConfig(async () => {
  ERP_BASE = await resolveErpBase(console);
  return {
  plugins: [react(), routesRebuildPlugin(), erpAuthPlugin()],
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
        // public hostname, not the 172.16.x LAN address: the LAN IP only resolves inside the
        // office network, so the dashboard died the moment anyone opened it from home or a
        // phone. life.gainup.in serves the same ERP and works from either side.
        target: ERP_BASE,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/erp/, "/api"),
        configure(proxy) {
          // the token is fetched by erpAuthPlugin's middleware, which has already run by
          // the time the request gets here — so this only has to attach it
          proxy.on("proxyReq", (proxyReq) => {
            if (erpToken) proxyReq.setHeader("Authorization", "Bearer " + erpToken);
          });
          // A rejected token is the one failure worth reacting to. Drop it so the next
          // call logs in again, instead of repeating the same dead token every 30 minutes
          // until someone restarts the dashboard.
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
              erpToken = null; erpTokenAt = 0;
            }
          });
        },
      },
    },
  },
  };
});
