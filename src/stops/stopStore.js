/* ============================================================================
 * stops/stopStore.js  —  Data access layer for bus-stop records
 * ----------------------------------------------------------------------------
 * The ONLY module that knows *where* stop data lives. Today that's
 * localStorage; tomorrow it can be the dashboard's real database. The UI talks
 * to this API and nothing else, so swapping the backend = rewriting just the
 * `backend` object at the bottom of this file. Nothing in the UI changes.
 *
 * Data shape — one flat master list of stops, each tagged with its route:
 *   {
 *     id:       string,        // stable unique id
 *     route:    string,        // e.g. "Route 1 - North"
 *     name:     string,        // stop name (from filename, editable)
 *     lat:      number|null,   // null until GPS found or manually pinned
 *     lng:      number|null,
 *     status:   "ok" | "no-gps" | "manual",
 *     source:   "exif" | "manual",
 *     filename: string,        // original photo filename (for dup detection)
 *   }
 *
 * Keeping the list flat (route as a field, not nested) makes CSV export,
 * sorting, and "reassign to another route" trivial — see exportCsv below.
 * ==========================================================================*/

const KEY = "stops-master-v1"; // bump if the record shape changes

const uid = () => Math.random().toString(36).slice(2, 9);

/** Derive the Status field from coordinates + how they were obtained. */
export function statusOf(stop) {
  if (stop.lat == null || stop.lng == null) return "no-gps";
  return stop.source === "manual" ? "manual" : "ok";
}

/** Human label for a status code (used by table + summary). */
export const STATUS_LABEL = {
  ok: "GPS OK",
  manual: "Manual pin",
  "no-gps": "No GPS — needs manual pin",
};

/* ------------------------------------------------------------------ backend */
/* The swappable persistence primitive. Reuses the dashboard's window.storage
 * shim when present (same mechanism Dashboard.jsx's Store uses), and falls back
 * to localStorage directly. Replace these two functions with API calls to move
 * to a server DB — the rest of the file is storage-agnostic. */
const backend = {
  read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
  write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* quota / private-mode: data stays in memory for the session */
    }
  },
};

/* -------------------------------------------------------------- public API */

/** Return the whole master list (a fresh array — safe to sort/map). */
export function getAll() {
  return backend.read().map((s) => ({ ...s, status: statusOf(s) }));
}

/** List of distinct route names, in first-seen order. */
export function getRoutes() {
  const seen = [];
  for (const s of backend.read()) if (!seen.includes(s.route)) seen.push(s.route);
  return seen;
}

/**
 * Add many parsed stops to a route at once (the bulk-import path).
 * Accepts the raw {name,lat,lng,hasGps} records from exif.js.
 * Returns the created rows (with ids/status) so the UI can react.
 */
export function addMany(route, parsed) {
  const list = backend.read();
  const created = parsed.map((p) => ({
    id: uid(),
    route,
    name: p.name,
    lat: p.hasGps ? p.lat : p.lat ?? null,
    lng: p.hasGps ? p.lng : p.lng ?? null,
    status: p.hasGps ? "ok" : "no-gps",
    source: "exif",
    filename: p.file ? p.file.name : p.filename || p.name,
  }));
  backend.write([...list, ...created]);
  return created;
}

/** Add a single blank/manual stop (e.g. typed in by hand). */
export function addOne(stop) {
  const list = backend.read();
  const row = {
    id: uid(),
    route: stop.route,
    name: stop.name || "Unnamed stop",
    lat: stop.lat ?? null,
    lng: stop.lng ?? null,
    source: stop.source || "manual",
    filename: stop.filename || "",
  };
  row.status = statusOf(row);
  backend.write([...list, row]);
  return row;
}

/** Patch a stop by id (name, route, lat, lng…). Recomputes status. */
export function update(id, patch) {
  const list = backend.read();
  const next = list.map((s) => {
    if (s.id !== id) return s;
    const merged = { ...s, ...patch };
    // If coordinates were typed/dropped manually, mark the source so the
    // status reads "Manual pin" instead of "GPS OK".
    if (("lat" in patch || "lng" in patch) && patch.source == null) {
      merged.source = "manual";
    }
    merged.status = statusOf(merged);
    return merged;
  });
  backend.write(next);
  return next.find((s) => s.id === id);
}

/** Delete a stop by id. */
export function remove(id) {
  backend.write(backend.read().filter((s) => s.id !== id));
}

/** Rename a route everywhere it appears. */
export function renameRoute(oldName, newName) {
  backend.write(
    backend.read().map((s) => (s.route === oldName ? { ...s, route: newName } : s))
  );
}

/** Wipe everything (used by a "clear all" action). */
export function clearAll() {
  backend.write([]);
}

/**
 * Does a stop with this name already exist (optionally within one route)?
 * Used to warn — NOT block — on duplicate names. Case-insensitive.
 */
export function findDuplicateNames(names, route = null) {
  const existing = backend.read().filter((s) => (route ? s.route === route : true));
  const set = new Set(existing.map((s) => s.name.toLowerCase()));
  const dups = [];
  for (const n of names) if (set.has((n || "").toLowerCase())) dups.push(n);
  return dups;
}

/* ------------------------------------------------------------------ export */

/** Summary counts for the "X of Y had GPS, Z need fixing" banner. */
export function summarize(list = getAll()) {
  const total = list.length;
  const withGps = list.filter((s) => s.lat != null && s.lng != null).length;
  return { total, withGps, needFix: total - withGps };
}

/**
 * CSV in the EXACT shape the route optimizer expects later:
 *     route,stop_name,latitude,longitude,headcount,absentee
 * headcount + absentee are intentionally left blank for the user to fill in.
 */
export function exportCsv(list = getAll()) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "route,stop_name,latitude,longitude,headcount,absentee";
  const rows = list.map((s) =>
    [esc(s.route), esc(s.name), esc(s.lat ?? ""), esc(s.lng ?? ""), "", ""].join(",")
  );
  return [header, ...rows].join("\n");
}

/** Same data as JSON (full fidelity, includes ids/status/source). */
export function exportJson(list = getAll()) {
  return JSON.stringify(list, null, 2);
}

/** Trigger a browser download of text content. */
export function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
