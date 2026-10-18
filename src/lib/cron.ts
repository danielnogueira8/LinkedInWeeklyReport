/**
 * Why Vercel's weekly cron would be turned away, or null when it's set up. Vercel only sends a
 * cron its Bearer token when CRON_SECRET is set, and production refuses a cron without one.
 */
export function cronSetupProblem(): string | null {
  if (process.env.CRON_SECRET || process.env.NODE_ENV !== "production") return null;
  return "Off: CRON_SECRET isn't set in Vercel, so the automatic run is turned away.";
}
