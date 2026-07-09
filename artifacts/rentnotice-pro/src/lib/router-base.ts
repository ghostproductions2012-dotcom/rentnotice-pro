/**
 * Computes the wouter router base from Vite's BASE_URL.
 *
 * BASE_URL is "/app/" on the hosted web build but "./" in the desktop (Tauri)
 * build, where Vite is given a relative base so assets load from the bundled
 * files. Wouter needs an ABSOLUTE base: passing "." meant no location ever
 * matched any route in the installed desktop app — the shell (sidebar, lock
 * screen) rendered but the main pane stayed permanently empty. Fall back to
 * "" (root) whenever the base is not an absolute path.
 */
export function computeRouterBase(baseUrl: string): string {
  return baseUrl.startsWith("/") ? baseUrl.replace(/\/$/, "") : "";
}
