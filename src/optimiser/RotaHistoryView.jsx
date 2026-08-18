/* ============================================================================
 * optimiser/RotaHistoryView.jsx — Rotational, as it was ACTUALLY operated.
 *
 * Everywhere else in the Optimiser reads the frozen roster: the three slots keep the riders
 * their plans were built for, so a plan stays costable against the people in it. That is the
 * plan. This screen is the opposite question — what actually ran on a given day — and it is
 * deliberately the one place that ignores the freeze and reads the punch feed date by date.
 *
 * Both are needed, and confusing them is what caused the wrong-slot reports: the rota steps
 * one place every Monday, so on any day after the freeze a rider's real slot may differ from
 * their planned one. Rather than hide that, the header counts it and the rows mark it.
 *
 * Source is rotaHistory from erp.js: date -> Empl_no -> [bus, slot, "P"|"A"], rotational
 * riders only. Names, home GPS and locality are joined in from `employees`.
 * ==========================================================================*/
import React, { useMemo, useState } from "react";
import { Bus, Users, MapPin, CalendarDays, AlertTriangle, Search } from "lucide-react";
import { Card, Tile, Empty, TextInput, SelectInput, Segmented } from "./ui.jsx";
import { ROTATION_SLOTS, fmtClock } from "./services.js";
import { stopsForRiders } from "./serviceStops.js";

/* Pun_Shift as punched -> the slot it means. The feed also carries "GS"/"G"/"GW" on a
   rotational rider (a day worked on general shift) and blanks where nobody clocked in;
   both are real states of the day, so they are shown rather than dropped. */
const SLOT_OF_CODE = { 1: "day", 2: "half", 3: "full" };
const slotMeta = (id) => ROTATION_SLOTS.find((s) => s.id === id) || null;

/* Same stop identity serviceStops.js gives a derived stop at MERGE_M = 0 — one stop per
   distinct home coordinate — so a rider can be tied to their stop without re-clustering. */
const stopKeyOf = (lat, lng) =>
  lat == null || lng == null ? null : "svc:" + lat.toFixed(5) + "," + lng.toFixed(5);

export default function RotaHistoryView({ t, rotaHistory, employees, depot }) {
  const dates = useMemo(
    () => Object.keys(rotaHistory || {}).sort().reverse(),
    [rotaHistory]
  );
  const [date, setDate] = useState("");
  const [slotFilter, setSlotFilter] = useState("all");
  const [q, setQ] = useState("");
  const day = date || dates[0] || "";

  const empById = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  /* Riders who have a rotational row on `day`, joined to who they are. One row per rider. */
  const riders = useMemo(() => {
    const rec = (rotaHistory || {})[day] || {};
    return Object.entries(rec).map(([id, v]) => {
      const [bus, code, att] = Array.isArray(v) ? v : [v, "", ""];
      const e = empById.get(id) || {};
      const ranSlot = SLOT_OF_CODE[code] || null;        // what they actually punched that day
      const planned = SLOT_OF_CODE[e.slot] || null;      // where the frozen roster plans them
      return {
        id,
        name: e.name || id,
        code: e.code || id,
        bus: bus || "—",
        ranSlot,
        rawCode: code,
        planned,
        moved: !!(ranSlot && planned && ranSlot !== planned),
        present: att === "P",
        lat: e.lat, lng: e.lng,
        locality: e.locality || "",
        absentee: e.absentee || 0,
        busId: bus || "",
      };
    });
  }, [rotaHistory, day, empById]);

  /* Stop per rider, derived exactly as the Stops board derives them, so a stop named here is
     the same stop named there rather than a second opinion. */
  const stopByRider = useMemo(() => {
    const withGps = riders.filter((r) => r.lat != null && r.lng != null);
    if (!withGps.length) return new Map();
    const stops = stopsForRiders(withGps, [], { depot: depot || null });
    const byKey = new Map(stops.map((s) => [s.id, s]));
    const m = new Map();
    riders.forEach((r) => {
      const s = byKey.get(stopKeyOf(r.lat, r.lng));
      if (s) m.set(r.id, s);
    });
    return m;
  }, [riders, depot]);

  const stopNameOf = (r) => {
    const s = stopByRider.get(r.id);
    return (s && s.name) || r.locality || "No GPS in the ERP";
  };

  /* Group into the three slots as OPERATED, plus the two states that are neither. */
  const groups = useMemo(() => {
    const g = { day: [], half: [], full: [], general: [], nopunch: [] };
    riders.forEach((r) => {
      if (r.ranSlot) g[r.ranSlot].push(r);
      else if (r.rawCode) g.general.push(r);
      else g.nopunch.push(r);
    });
    return g;
  }, [riders]);

  const needle = q.trim().toLowerCase();
  const matches = (r) =>
    !needle ||
    r.name.toLowerCase().includes(needle) ||
    r.code.toLowerCase().includes(needle) ||
    r.bus.toLowerCase().includes(needle) ||
    stopNameOf(r).toLowerCase().includes(needle);

  const shownSlots = ROTATION_SLOTS.filter((s) => slotFilter === "all" || slotFilter === s.id);
  const totalRan = groups.day.length + groups.half.length + groups.full.length;
  const movedCount = riders.filter((r) => r.moved).length;
  const busesRan = new Set(riders.filter((r) => r.ranSlot && r.busId).map((r) => r.busId)).size;

  if (!dates.length) {
    return (
      <Empty t={t} title="No operating history yet"
        sub="This reads the ERP punch feed day by day. Sync from the ERP and the days it carries appear here." />
    );
  }

  return (
    <div className="space-y-4">
      <Card t={t} title="Rotational — as operated"
        hint="What actually ran on a chosen day, straight from the punch feed: the slot each rider clocked, the bus they rode and the stop they belong to. The rest of the Optimiser reads the frozen planning roster; this screen deliberately does not, so the two can be compared.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.faint }}>Day</span>
            <SelectInput t={t} value={day} onChange={(e) => setDate(e.target.value)} className="min-w-[11rem]">
              {dates.map((d) => (
                <option key={d} value={d}>{d} · {new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" })}</option>
              ))}
            </SelectInput>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.faint }}>Slot</span>
            <Segmented t={t} small value={slotFilter} onChange={setSlotFilter}
              options={[["all", "All"], ...ROTATION_SLOTS.map((s) => [s.id, s.name])]} />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[14rem]">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.faint }}>Find</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: t.faint }} />
              <TextInput t={t} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 w-full"
                placeholder="Employee, code, bus or stop…" />
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Tile t={t} label="Riders that day" value={totalRan.toLocaleString("en-IN")} sub={`${riders.length} rotational rows`} />
          <Tile t={t} label="Buses used" value={busesRan} sub="distinct registrations" />
          <Tile t={t} label="Off the planned slot" value={movedCount.toLocaleString("en-IN")}
            sub={movedCount ? "the rota had moved them" : "matches the roster"} accent={movedCount ? t.watch : undefined} />
          <Tile t={t} label="Not on a slot" value={(groups.general.length + groups.nopunch.length).toLocaleString("en-IN")}
            sub={`${groups.general.length} on general · ${groups.nopunch.length} no punch`} />
        </div>
      </Card>

      {shownSlots.map((sl) => {
        const all = groups[sl.id] || [];
        const rows = all.filter(matches);
        const byBus = new Map();
        rows.forEach((r) => {
          if (!byBus.has(r.bus)) byBus.set(r.bus, []);
          byBus.get(r.bus).push(r);
        });
        const buses = [...byBus.entries()].sort((a, b) => b[1].length - a[1].length);
        return (
          <Card key={sl.id} t={t}
            title={`${sl.name} · ${fmtClock(sl.from)}–${fmtClock(sl.to % 1440)}`}
            hint={`${all.length} riders across ${new Set(all.map((r) => r.bus)).size} buses on ${day}${needle && rows.length !== all.length ? ` · ${rows.length} match "${q}"` : ""}`}
            right={<span className="w-3 h-3 rounded-sm inline-block" style={{ background: sl.color }} />}>
            {!rows.length ? (
              <div className="text-sm" style={{ color: t.faint }}>
                {all.length ? "Nothing matches that search in this slot." : "Nobody ran this slot on this day."}
              </div>
            ) : (
              <div className="space-y-3">
                {buses.map(([bus, list]) => (
                  <div key={bus} className="rounded-xl border overflow-hidden" style={{ borderColor: t.border }}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2" style={{ background: t.surface2 }}>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-sm" style={{ color: t.text }}>
                        <Bus size={14} style={{ color: t.muted }} />{bus}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: t.muted }}>
                        <Users size={12} />{list.length} riders
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: t.muted }}>
                        <MapPin size={12} />{new Set(list.map(stopNameOf)).size} stops
                      </span>
                      <span className="text-xs" style={{ color: t.muted }}>
                        {list.filter((r) => r.present).length} present
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" style={{ minWidth: 560 }}>
                        <thead>
                          <tr style={{ color: t.muted }}>
                            {["Employee", "Code", "Stop", "Attendance", ""].map((h) => (
                              <th key={h} className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wider"
                                style={{ borderBottom: "1px solid " + t.border }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {list.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
                            <tr key={r.id} style={{ borderTop: "1px solid " + t.border }}>
                              <td className="py-2 px-3" style={{ color: t.text }}>{r.name}</td>
                              <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{r.code}</td>
                              <td className="py-2 px-3" style={{ color: t.muted }}>{stopNameOf(r)}</td>
                              <td className="py-2 px-3">
                                <span className="text-xs font-semibold" style={{ color: r.present ? t.good : t.muted }}>
                                  {r.present ? "Present" : "Absent"}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                {r.moved && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.watch }}
                                    title={`The planning roster has this rider on ${slotMeta(r.planned) ? slotMeta(r.planned).name : r.planned}. The rota had moved them by this day.`}>
                                    <AlertTriangle size={11} />
                                    planned {slotMeta(r.planned) ? slotMeta(r.planned).name : r.planned}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {(groups.general.length > 0 || groups.nopunch.length > 0) && slotFilter === "all" && (
        <Card t={t} title="On no slot that day"
          hint="A rotational rider whose punch that day was a general shift, or who did not clock in at all. Neither is an error — it is what the feed says — but neither belongs to one of the three runs.">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: t.muted }}>
                <CalendarDays size={12} className="inline mr-1" />Worked a general shift
              </div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: t.text }}>{groups.general.length}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: t.muted }}>No punch</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: t.text }}>{groups.nopunch.length}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
