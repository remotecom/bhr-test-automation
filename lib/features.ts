/**
 * Feature toggles for which parts of the dashboard are shown.
 *
 * NEXT_PUBLIC_SHOW_CM: the contractor (CM, CM+, COR) screens, i.e. Test Suite and Playground.
 *   unset or anything else -> shown (default, so local dev behaves as before)
 *   "false"                 -> hidden; the app opens on the Payroll (GP) tab
 *
 * NEXT_PUBLIC_ variables are baked into the page at build time, so after changing this in
 * Vercel you need to redeploy. Hiding a screen only hides the UI: its API routes still exist
 * behind the login.
 */
export const SHOW_CM = process.env.NEXT_PUBLIC_SHOW_CM !== "false";

/**
 * GP_RUNS: whether this build can run anything on the Payroll (GP) tab: the report, test employees,
 * skipped-field checks and testing-guide checks. They use the deployer's client credentials and write
 * to a sandbox, so a deployed (partner-facing) build only shows published results.
 *   npm run dev                  -> on
 *   production build (Vercel)    -> off, unless NEXT_PUBLIC_GP_RUNS=true
 * The API routes enforce this too (gpRunsRefused), not just the UI.
 */
export const GP_RUNS = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_GP_RUNS === "true";

/** For GP API routes that run or write: a 403 response when runs are off in this build, else null */
export function gpRunsRefused(): Response | null {
  return GP_RUNS
    ? null
    : Response.json({ error: "This build only shows published results. Run GP checks locally with npm run dev." }, { status: 403 });
}
