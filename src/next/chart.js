/* Chart styling for recharts in the new look. Charts keep real colours (one hue per company or
   named category); the chrome around them is quiet: dashed horizontal guides only, no tick marks,
   no Y axis line, 11px grey ticks, values printed on the marks, a small white tooltip card. */
export { COMPANY_HEX } from "./ui.jsx";

export const GRID = { strokeDasharray: "4 4", stroke: "#e9ebf0", vertical: false };
export const X_AXIS = { tick: { fontSize: 11, fill: "#646b78" }, tickLine: false, axisLine: { stroke: "#e9ebf0" }, tickMargin: 8 };
export const Y_AXIS = { tick: { fontSize: 11, fill: "#646b78" }, tickLine: false, axisLine: false, width: 52 };
export const TOOLTIP = {
  contentStyle: { background: "#fff", border: "none", borderRadius: 16, boxShadow: "0 8px 24px rgba(23,30,60,.10), 0 1px 2px rgba(23,30,60,.05)", fontSize: 13, padding: "8px 12px" },
  labelStyle: { color: "#646b78", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "#0b0d12", padding: 0 },
  cursor: { fill: "rgba(11,13,18,.04)" },
};
export const LABEL = { fontSize: 11, fill: "#646b78", fontWeight: 600 };
/* For categories that are not companies: distinct, readable on white, none of them the status hues. */
export const SERIES = ["#0e7490", "#7c3aed", "#be1250", "#2f7bf5", "#a16207", "#0f766e", "#9333ea", "#475569", "#c2410c", "#4d7c0f"];
