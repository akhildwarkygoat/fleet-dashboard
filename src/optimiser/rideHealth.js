/* Ride time health, one rule for every page (Akhil, 2026-10-02): a plan's average ride is fine up
   to 45 minutes, and its longest ride (one bus's trip, end to end) up to 1 h 30 min. Over either
   is shown red. These colour the figures only; the optimiser's own planning limits (engine.js)
   are separate. */
export const AVG_RIDE_MAX = 45;
export const LONGEST_RIDE_MAX = 90;

export const avgRideOk = (min) => min <= AVG_RIDE_MAX;
export const longestRideOk = (min) => min <= LONGEST_RIDE_MAX;
