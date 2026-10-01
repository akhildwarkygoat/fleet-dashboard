/* Fit a drawn map back to its routes without building it again. MasterRouteMap keeps its Leaflet
   map to itself, and building it again refetches every route's road line, so each map is noted
   here as Leaflet creates it and found again from its container. */
import L from "leaflet";

const maps = new WeakMap();
L.Map.addInitHook(function note() { maps.set(this.getContainer(), this); });

/** Fit the map inside the same .nx-map frame as `from` to everything drawn on it. */
export function fitMap(from) {
  const el = from.closest(".nx-map")?.querySelector(".leaflet-container");
  const map = el && maps.get(el);
  if (!map) return;
  const bounds = L.latLngBounds([]);
  map.eachLayer((layer) => {
    if (layer.getBounds) bounds.extend(layer.getBounds());
    else if (layer.getLatLng) bounds.extend(layer.getLatLng());
  });
  // the same padding the map fits with when it is drawn
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
}
