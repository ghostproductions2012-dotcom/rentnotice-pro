/**
 * Glue for the native desktop shell (Tauri): menu-driven navigation,
 * per-route native window titles (shown in the macOS Window menu), and
 * multi-window helpers.
 *
 * Every export is a safe no-op in the plain web build, where
 * `window.__TAURI__` is absent.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { tauriInvoke } from "./download";

type TauriEventApi = {
  listen?: (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>;
};
type TauriWindowApi = {
  getCurrentWindow?: () => { setTitle?: (title: string) => Promise<void> };
};

function tauriGlobal(): { event?: TauriEventApi; window?: TauriWindowApi } | null {
  if (typeof window === "undefined") return null;
  const tauri = (window as { __TAURI__?: { event?: TauriEventApi; window?: TauriWindowApi } })
    .__TAURI__;
  return tauri ?? null;
}

/** True when running inside the packaged desktop app. */
export function isDesktopShell(): boolean {
  return tauriInvoke() !== null;
}

/** Longest-prefix-first mapping of routes to window title sections. */
const SECTION_TITLES: Array<[prefix: string, title: string]> = [
  ["/notices/new", "New Notice"],
  ["/notices", "Notices"],
  ["/properties", "Properties"],
  ["/tenants", "Tenants"],
  ["/import", "Ledger Import"],
  ["/calendar", "Calendar"],
  ["/field-service", "Field Service"],
  ["/maintenance", "Maintenance"],
  ["/communications", "Communications"],
  ["/templates", "Templates"],
  ["/state-rules", "State Rules"],
  ["/reports", "Reports"],
  ["/audit", "Audit Log"],
  ["/settings", "Settings"],
];

function sectionTitle(location: string): string | null {
  if (location === "/") return "Dashboard";
  const hit = SECTION_TITLES.find(([prefix]) => location.startsWith(prefix));
  return hit ? hit[1] : null;
}

/**
 * Opens a new independent desktop window, optionally deep-linked to a route.
 * The route travels out-of-band (stashed in Rust, picked up by the new
 * window via `take_initial_route`) because query-string URLs break wouter's
 * route matching under the desktop bundle's relative base.
 */
export async function openInNewWindow(route?: string): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("open_window", { route: route ?? null });
}

/**
 * Mounts the desktop-shell behaviors. Must be rendered inside the wouter
 * router so menu navigation uses the same base-aware location hook.
 */
export function useDesktopShell(): void {
  const [location, setLocation] = useLocation();

  // Native menu navigation (Settings…, File > New Notice, View sections).
  useEffect(() => {
    const listen = tauriGlobal()?.event?.listen;
    if (!listen) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen("menu:navigate", (event) => {
      if (typeof event.payload === "string" && event.payload.startsWith("/")) {
        setLocation(event.payload);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setLocation]);

  // One-shot deep link for windows opened via openInNewWindow(route).
  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    void invoke("take_initial_route")
      .then((route) => {
        if (typeof route === "string" && route.startsWith("/")) setLocation(route);
      })
      .catch(() => {
        /* older shells without the command — ignore */
      });
    // Run once per window boot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route-specific native window titles so the macOS Window menu lists
  // windows meaningfully ("RentNotice Pro — Tenants", …).
  useEffect(() => {
    const win = tauriGlobal()?.window?.getCurrentWindow?.();
    if (!win?.setTitle) return;
    const section = sectionTitle(location);
    void win
      .setTitle(section ? `RentNotice Pro — ${section}` : "RentNotice Pro")
      .catch(() => {});
  }, [location]);
}
