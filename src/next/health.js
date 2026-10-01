/* A bus's (or a company's) health in the new look, from seats filled only. Akhil's thresholds,
   2026-10-01:
     good   90 to 125%                      green
     watch  50 to 90%, or 125 to 150%       orange
     bad    under 50%, or over 150%         red
   Judged on the whole percent shown on screen, so the colour always matches the number. Every new
   page reads health from here; the old look keeps its own rule (healthOf in Dashboard.jsx). */

export const HEALTH = {
  good: { tone: "ok", label: "Good" },
  watch: { tone: "warn", label: "Watch" },
  bad: { tone: "bad", label: "Bad" },
};
/** Worst first, for sorting. */
export const HEALTH_RANK = { bad: 0, watch: 1, good: 2 };

/** "good" | "watch" | "bad" for a seats-filled percent; null when it is not known. */
export function utilHealth(util) {
  if (util == null || !Number.isFinite(+util)) return null;
  const u = Number((+util).toFixed(0));
  if (u >= 90 && u <= 125) return "good";
  if (u < 50 || u > 150) return "bad";
  return "watch";
}

/** Tone for a Badge, Tag or Progress fill ("ok" | "warn" | "bad"), or the fallback when unknown. */
export const healthTone = (util, fallback = "ink") => {
  const h = utilHealth(util);
  return h ? HEALTH[h].tone : fallback;
};
