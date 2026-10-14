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
