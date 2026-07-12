/* ============================================================================
 * stops/StopExtractor.jsx  —  EXIF GPS Stop Extractor (module entry point)
 * ----------------------------------------------------------------------------
 * Orchestrates the whole feature. Drops into the dashboard as <StopExtractor
 * t={t} toast={toast} />. Owns the workflow state and wires together the four
 * concerns, each of which lives in its own file:
 *
 *     exif.js        photo  -> { name, lat, lng, hasGps }     (parsing)
 *     stopStore.js   the persistence + CSV/JSON export layer   (data)
 *     StopMap.jsx    Leaflet map of pins                       (map view)
 *     StopTable.jsx  sortable/editable master list             (table view)
 *
 * The workflow (top of screen down):
 *   1. Name a route.
 *   2. Bulk drag-and-drop that route's photos (or click to pick).
 *   3. EXIF is read in-browser; stops appear in the table + on the map.
 *   4. A summary banner reports "X of Y had GPS, Z need fixing".
 *   5. Fix no-GPS stops by typing coords or dropping a pin.
 *   6. Export the whole master list as optimizer-ready CSV (or JSON).
 *
 * To later "send stops straight to the optimizer", read `stops` (or call
 * stopStore.getAll()) and POST stopStore.exportCsv() to your endpoint — no UI
 * rewrite needed.
 * ==========================================================================*/

import React, { useState, useMemo, useRef, useCallback } from "react";
import { Upload, FolderPlus, Download, MapPin, AlertTriangle, FileWarning, Trash2 } from "lucide-react";
import { parsePhotos } from "./exif.js";
import * as store from "./stopStore.js";
import { Card, Btn, Field, TextInput, Empty, routeColorMap } from "./ui.jsx";
import StopMap from "./StopMap.jsx";
import StopTable from "./StopTable.jsx";

export default function StopExtractor({ t, toast }) {
  // Master list mirrored from the store; reload() re-reads after every mutation
  // so the store stays the single source of truth.
  const [stops, setStops] = useState(() => store.getAll());
  const reload = useCallback(() => setStops(store.getAll()), []);

  const [routeName, setRouteName] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [dropPinFor, setDropPinFor] = useState(null); // stop id awaiting a map click
  const [groupByRoute, setGroupByRoute] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(null);     // {done,total} during import
  const [notice, setNotice] = useState(null);          // {kind,text} dismissible banner
  const fileRef = useRef(null);

  const routes = useMemo(() => store.getRoutes(), [stops]);
  const routeColors = useMemo(() => routeColorMap(routes), [routes]);
  const summary = useMemo(() => store.summarize(stops), [stops]);

  /* ----------------------------------------------------------- import flow */
  const handleFiles = useCallback(async (fileList) => {
    const route = routeName.trim();
    if (!route) { setNotice({ kind: "warn", text: "Name the route first, then drop photos into it." }); return; }
    if (!fileList || fileList.length === 0) return;

    setProgress({ done: 0, total: fileList.length });
    const { stops: parsed, skipped } = await parsePhotos(fileList, (done, total) => setProgress({ done, total }));
    setProgress(null);

    if (parsed.length === 0) {
      setNotice({ kind: "warn", text: skipped.length ? `Ignored ${skipped.length} non-image file(s). No photos to read.` : "No images found." });
      return;
    }

    // Warn (don't block) on duplicate stop names already in this route.
    const dups = store.findDuplicateNames(parsed.map((p) => p.name), route);

    store.addMany(route, parsed);
    reload();

    const withGps = parsed.filter((p) => p.hasGps).length;
    const msgs = [`Added ${parsed.length} stop(s) to “${route}” — ${withGps} with GPS, ${parsed.length - withGps} need a manual pin.`];
    if (skipped.length) msgs.push(`Ignored ${skipped.length} non-image file(s).`);
    if (dups.length) msgs.push(`⚠ Duplicate name(s) already in this route: ${[...new Set(dups)].join(", ")}.`);
    setNotice({ kind: dups.length ? "warn" : "ok", text: msgs.join(" ") });
    toast && toast(`Imported ${parsed.length} stop(s)`);
  }, [routeName, reload, toast]);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  /* --------------------------------------------------------- table actions */
  const onUpdate = (id, patch) => { store.update(id, patch); reload(); };
  const onDelete = (id) => { store.remove(id); if (selectedId === id) setSelectedId(null); reload(); toast && toast("Stop deleted"); };
  const onPinRequest = (id) => { setSelectedId(id); setDropPinFor(id); setNotice({ kind: "info", text: "Click the map to set this stop's coordinates." }); };

  const onDropPin = (lat, lng) => {
    if (!dropPinFor) return;
    store.update(dropPinFor, { lat, lng, source: "manual" });
    setDropPinFor(null);
    reload();
    toast && toast("Pin placed");
  };

  /* --------------------------------------------------------------- exports */
  const exportCsv = () => {
    if (!stops.length) { toast && toast("Nothing to export"); return; }
    store.download("bus_stops.csv", store.exportCsv(stops), "text/csv");
  };
  const exportJson = () => {
    if (!stops.length) { toast && toast("Nothing to export"); return; }
    store.download("bus_stops.json", store.exportJson(stops), "application/json");
  };

  const clearAll = () => {
    if (!stops.length) return;
    if (!window.confirm("Delete ALL stops across every route? This cannot be undone.")) return;
    store.clearAll(); setSelectedId(null); setDropPinFor(null); reload(); toast && toast("Cleared all stops");
  };

  /* ------------------------------------------------------------------ view */
  const noticeStyle = {
    ok: { background: t.goodSoft, color: t.good },
    warn: { background: t.watchSoft, color: t.watch },
    info: { background: t.primarySoft, color: t.primary },
  }[notice?.kind] || {};

  return (
    <div className="space-y-5">
      {/* ---- 1 & 2: name a route + bulk drop photos ---- */}
      <Card t={t} title="Add a route" hint="Name the route, then drop in that route's geotagged photos. Photos are read in your browser — they are never uploaded.">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Field t={t} label="Route name">
              <TextInput t={t} value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="e.g. Route 1 - North" />
            </Field>
          </div>
          <Btn t={t} variant="ghost" onClick={() => fileRef.current?.click()}>
            <FolderPlus size={16} /> Choose photos
          </Btn>
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        </div>

        {/* drag-and-drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className="mt-4 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center py-10 text-center transition"
          style={{ borderColor: dragOver ? t.primary : t.border, background: dragOver ? t.primarySoft : t.surface2, color: t.muted }}>
          <Upload size={28} style={{ color: dragOver ? t.primary : t.muted }} />
          <div className="mt-2 text-sm font-medium" style={{ color: t.text }}>
            {routeName.trim() ? `Drop photos for “${routeName.trim()}” here` : "Name a route above, then drop photos here"}
          </div>
          <div className="text-xs mt-1">JPEG / PNG / TIFF / HEIC · stop name comes from each filename</div>
        </div>

        {/* import progress for big batches */}
        {progress && (
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1" style={{ color: t.muted }}>
              <span>Reading EXIF…</span><span>{progress.done} / {progress.total}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: t.surface2 }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%`, background: t.primary }} />
            </div>
          </div>
        )}

        {/* dismissible result / warning banner */}
        {notice && (
          <div className="mt-4 rounded-xl px-4 py-3 text-sm flex items-start gap-2" style={noticeStyle}>
            {notice.kind === "warn" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <MapPin size={16} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">✕</button>
          </div>
        )}
      </Card>

      {/* ---- summary counts + exports ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat t={t} label="Routes" value={routes.length} accent={t.primary} />
        <Stat t={t} label="Total stops" value={summary.total} accent={t.text} />
        <Stat t={t} label="With GPS" value={summary.withGps} accent={t.good} />
        <Stat t={t} label="Need manual fix" value={summary.needFix} accent={summary.needFix ? t.poor : t.muted}
          sub={summary.needFix ? <span className="inline-flex items-center gap-1"><FileWarning size={12} /> needs a pin</span> : "all set"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm" style={{ color: t.muted }}>
          <strong style={{ color: t.text }}>{summary.withGps}</strong> of <strong style={{ color: t.text }}>{summary.total}</strong> photos had GPS
          {summary.needFix > 0 && <> · <strong style={{ color: t.poor }}>{summary.needFix}</strong> need manual fixing</>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn t={t} onClick={exportCsv}><Download size={16} /> Export CSV</Btn>
          <Btn t={t} variant="ghost" onClick={exportJson}><Download size={16} /> JSON</Btn>
          <Btn t={t} variant="danger" onClick={clearAll}><Trash2 size={16} /> Clear all</Btn>
        </div>
      </div>

      {/* ---- map + table ---- */}
      {stops.length === 0 ? (
        <Card t={t}><Empty t={t} title="No stops yet" sub="Name a route above and drop in some geotagged photos to begin." /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <StopMap t={t} stops={stops} routeColors={routeColors} selectedId={selectedId}
            onSelect={setSelectedId} dropPinMode={!!dropPinFor} onDropPin={onDropPin} />
          {/* route color legend */}
          <div className="lg:col-span-2 order-3">
            <StopTable t={t} stops={stops} routes={routes} routeColors={routeColors} selectedId={selectedId}
              onSelect={setSelectedId} onUpdate={onUpdate} onDelete={onDelete} onPinRequest={onPinRequest}
              groupByRoute={groupByRoute} setGroupByRoute={setGroupByRoute} />
          </div>
          <div className="order-2 lg:order-none">
            <Card t={t} title="Routes">
              <div className="flex flex-wrap gap-2">
                {routes.map((r) => (
                  <span key={r} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm"
                    style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}>
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: routeColors[r] }} />
                    {r}
                    <span style={{ color: t.muted }}>{stops.filter((s) => s.route === r).length}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact stat tile (mirrors the dashboard's Tile, simplified). */
function Stat({ t, label, value, sub, accent }) {
  return (
    <div className="rounded-2xl border p-4 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent || t.primary }} />
      <div className="text-xs uppercase tracking-widest" style={{ color: t.muted }}>{label}</div>
      <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: t.text }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: t.muted }}>{sub}</div>}
    </div>
  );
}
