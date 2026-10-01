/* Small readings shared by the Live page's parts. The arithmetic stays in Dashboard.jsx; these only
   decide how a figure it worked out reads on screen. */
import { NEEDS_ERP, RUN_OPTIMISER } from "../../../erp.js";
import { percent } from "../../format.js";

/** Seats filled, or null when the ERP has no seat count for the bus: "—", never a false 0%. */
export const utilOf = (m) => (m.capacity > 0 || m.cap > 0 ? m.util : null);

/** The digits of a whole percent, for numbers whose % is drawn as a smaller grey unit. */
export const pctDigits = (n) => percent(n).replace("%", "");


/** Cost per head both ways; null ("—") when there was no spend to share or nobody rode, never ₹0.
 *  Takes one bus's metricsFor result or an aggregate: both carry these keys. */
export const perHead = (m) => ({
  km: m.present > 0 && m.spend > 0 ? m.cph : null,
  diesel: m.present > 0 && m.spend_diesel > 0 ? m.cph_diesel : null,
});

/** Net value a year both ways; null ("—") when the bus has neither a cost nor a budget. */
export const netYear = (m) => ({
  km: m.spend > 0 || m.budget > 0 ? m.netAnnual : null,
  diesel: m.spend_diesel > 0 || m.budget > 0 ? m.netAnnual_diesel : null,
});

/** Route and driver without the ERP's "not known yet" placeholders, as the Bus page's finder reads them. */
export const routeOf = (bus) => (bus.route && bus.route !== RUN_OPTIMISER ? bus.route : "");
export const driverOf = (bus) => (bus.driver && bus.driver !== NEEDS_ERP ? bus.driver : "");
