/* ============================================================================
 * optimiser/ui.jsx — re-export shim.
 * ----------------------------------------------------------------------------
 * This file used to hold its own copy of the dashboard's primitives, "matched
 * 1:1 to Dashboard.jsx". It wasn't, and couldn't stay that way: the copies
 * dropped the data-fx hooks (so this tab alone never animated in), lost the
 * fxPress feedback on buttons, lost CountUp on tiles, and grew a completely
 * different segmented control.
 *
 * The primitives now live in src/ui/kit.jsx. This file stays so the nine
 * modules importing "./ui.jsx" don't have to change.
 *
 * See docs/ui-design-system.md.
 * ==========================================================================*/
export {
  Card, Btn, Field, inputStyle, TextInput, SelectInput, Tile, Empty,
  StatusPill, Pill, Segmented, Switch, Modal, CountUp, Reveal,
  makeTooltip, routeColorMap, readableOn, PALETTE,
} from "../ui/kit.jsx";
