/* Pages live in the address after # (#/live, #/bus/TN57AB3636), so the browser's Back button and a
   refresh keep you where you were. */
import { useEffect, useState } from "react";

export const PAGE_KEYS = ["live", "costs", "optimiser", "compare", "settings", "bus"];

export function readRoute() {
  const [page, ...rest] = window.location.hash.replace(/^#\/?/, "").split("/");
  return PAGE_KEYS.includes(page) ? { page, id: rest.length ? decodeURIComponent(rest.join("/")) : null } : { page: "live", id: null };
}
/** Open a page: go("live"), go("bus", bus.id). */
export const go = (page, id) => { window.location.hash = "/" + page + (id ? "/" + encodeURIComponent(id) : ""); };
export const hrefFor = (page, id) => "#/" + page + (id ? "/" + encodeURIComponent(id) : "");

export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
