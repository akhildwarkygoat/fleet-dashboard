/* The old components are coloured by a theme object `t`. When the new look has to show one of
   them as it is (a map, an editor it has not rebuilt yet), pass NT instead of the old light theme:
   same shape, new-look colours, so the old part sits in the new page without clashing. */
import { THEMES } from "../Dashboard.jsx";

export const NT = {
  ...THEMES.light,
  name: "next", bg: "#f4f5f8", surface: "#ffffff", surface2: "#f4f5f8", raised: "#eceef3",
  border: "#e9ebf0", text: "#0b0d12", muted: "#646b78", faint: "#9aa0ab",
  primary: "#0b0d12", primarySoft: "rgba(11,13,18,.06)", onPrimary: "#ffffff", primaryStrong: "#0b0d12",
  good: "#15803d", watch: "#a16207", poor: "#b91c1c",
  goodSoft: "#e7f7ec", watchSoft: "#fff4dc", poorSoft: "#feecec",
  grid: "#e9ebf0", inputBg: "#eceef3",
};
