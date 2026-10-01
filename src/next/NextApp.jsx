/* The new look's shell: a white top bar that scrolls away with the page, the pages, and one
   floating frosted icon bar at the bottom (the only fixed chrome). Status appears only when
   something is off. Data comes from useFleetData, the same source as the old look. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChartLine, House, IndianRupee, RotateCw, Route, Settings as SettingsIcon } from "lucide-react";
import { useFleetData } from "../Dashboard.jsx";
import { Badge, Button, Toast, cx } from "./ui.jsx";
import { clock } from "./format.js";
import { go, hrefFor, useRoute } from "./route.js";
import LivePage from "./pages/LivePage.jsx";
import BusPage from "./pages/BusPage.jsx";
import SoonPage from "./pages/SoonPage.jsx";

const NAV = [
  { key: "live", label: "Live", icon: House },
  { key: "costs", label: "Costs", icon: IndianRupee },
  { key: "optimiser", label: "Optimiser", icon: Route },
  { key: "compare", label: "Compare", icon: ChartLine },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

/** The ERP pull is older than twice the refresh interval (at least an hour): say so. */
function useStale(erpStatus, settings) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  if (erpStatus.phase !== "ok" || !erpStatus.at || !settings.erpAuto) return false;
  const limit = Math.max(60, 2 * (+settings.erpRefreshMin || 0)) * 60_000;
  return now - erpStatus.at > limit;
}

export default function NextApp() {
  const route = useRoute();
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef();
  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);
  const fleet = useFleetData({ toast, onHome: () => go("live") });
  const stale = useStale(fleet.erpStatus, fleet.settings);
  const active = route.page === "bus" ? "live" : route.page;

  let page;
  if (route.page === "live") page = <LivePage fleet={fleet} />;
  else if (route.page === "bus") page = <BusPage fleet={fleet} busId={route.id} toast={toast} />;
  else page = <SoonPage key={route.page} name={NAV.find((n) => n.key === route.page).label} />;

  return (
    <div className="min-h-screen font-ui text-ink">
      <header className="bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <a href={hrefFor("live")} className="flex min-w-0 items-center gap-2.5 rounded-pill" aria-label="Transport dashboard, go to Live">
            {/* the Gainup mark in ink, nothing behind it */}
            <span aria-hidden className="block h-8 w-8 shrink-0 bg-ink"
              style={{ WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
            <span className="truncate text-[15px] font-bold tracking-[-0.01em]">Transport dashboard</span>
          </a>
          <div className="ml-auto flex items-center gap-2" aria-live="polite">
            {fleet.erpStatus.phase === "error" && (
              <>
                <Badge tone="bad" title={fleet.erpStatus.msg || undefined}>ERP offline</Badge>
                <Button variant="ghost" size="sm" icon={RotateCw} onClick={() => fleet.syncErp()}>Retry</Button>
              </>
            )}
            {stale && <Badge tone="bad" title={"Last ERP update " + clock(fleet.erpStatus.at)}>Data may be stale</Badge>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-5 sm:px-6 sm:pt-6">{page}</main>

      <nav aria-label="Pages" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="glass pointer-events-auto flex items-center gap-1 rounded-hero p-1.5 shadow-float">
          {NAV.map((n, i) => {
            const on = active === n.key;
            const Icon = n.icon;
            return (
              <React.Fragment key={n.key}>
                {i === 1 && <span aria-hidden className="mx-0.5 h-6 w-px bg-line" />}
                <a href={hrefFor(n.key)} aria-label={n.label} title={n.label} aria-current={on ? "page" : undefined}
                  className={cx("flex h-12 w-12 items-center justify-center rounded-pill transition-[background-color,color,transform] duration-150 active:scale-[0.94] sm:h-11 sm:w-14",
                    on ? "bg-ink text-white" : "text-ink-3 hover:bg-satin-2 hover:text-ink")}>
                  <Icon size={22} strokeWidth={2} aria-hidden />
                </a>
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      <Toast msg={toastMsg} />
    </div>
  );
}
