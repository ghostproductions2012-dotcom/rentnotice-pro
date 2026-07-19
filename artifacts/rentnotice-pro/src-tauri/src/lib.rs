use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// Sequence for aux window labels. Labels must match the `aux-*` glob in
/// capabilities/default.json or the new window gets zero IPC permissions.
static AUX_WINDOW_SEQ: AtomicU64 = AtomicU64::new(1);

/// Menu/runtime bookkeeping shared across windows.
#[derive(Default)]
struct MenuState {
    /// Label of the most recently focused window; menu actions target it.
    focused_label: Mutex<String>,
    /// Per-window webview zoom factors (View > Zoom In/Out/Actual Size).
    zoom: Mutex<HashMap<String, f64>>,
    /// Deep-link routes for windows opened via `open_window`, consumed once by
    /// `take_initial_route`. Passed out-of-band because the desktop bundle's
    /// wouter base is "" and query-string URLs would break route matching.
    pending_routes: Mutex<HashMap<String, String>>,
}

/// Native "Save as…" for generated PDFs.
///
/// The macOS WKWebView silently ignores anchor-downloads of blob: URLs, so the
/// frontend calls this command when running inside Tauri. Declared `async` so
/// the blocking save dialog runs off the main thread.
///
/// Returns the saved path, or `None` when the user cancelled the dialog.
#[tauri::command]
async fn save_file(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("PDF document", &["pdf"])
        .blocking_save_file();
    match picked {
        Some(path) => {
            let path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Basic build info for the in-app update checker: the running version plus
/// the OS/arch this binary was compiled for, so the frontend can pick the
/// matching installer from the release feed.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    os: String,
    arch: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Native "Save as…" for downloaded update installers (.dmg / .exe / .msi).
/// Mirrors `save_file` but filters on the installer's own extension instead
/// of PDF. Returns the saved path, or `None` when the user cancelled.
#[tauri::command]
async fn save_installer(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut dialog = app.dialog().file().set_file_name(&file_name);
    if !ext.is_empty() {
        dialog = dialog.add_filter("Installer", &[ext.as_str()]);
    }
    match dialog.blocking_save_file() {
        Some(path) => {
            let path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Opens an additional app window. `route` (must start with '/') deep-links
/// the new window once its frontend boots and calls `take_initial_route`.
#[tauri::command]
fn open_window(app: AppHandle, route: Option<String>) -> Result<(), String> {
    open_aux_window(&app, route).map_err(|e| e.to_string())
}

/// One-shot pickup of the deep-link route stashed for this window by
/// `open_window`. Returns `None` for the main window / plain new windows.
#[tauri::command]
fn take_initial_route(window: tauri::WebviewWindow) -> Option<String> {
    let state = window.app_handle().state::<MenuState>();
    let route = state.pending_routes.lock().unwrap().remove(window.label());
    route
}

fn open_aux_window<R: Runtime>(app: &AppHandle<R>, route: Option<String>) -> tauri::Result<()> {
    let seq = AUX_WINDOW_SEQ.fetch_add(1, Ordering::SeqCst);
    let label = format!("aux-{seq}");
    if let Some(route) = route.filter(|r| r.starts_with('/')) {
        app.state::<MenuState>()
            .pending_routes
            .lock()
            .unwrap()
            .insert(label.clone(), route);
    }
    // Slightly smaller than the main window and not centered, so stacked
    // windows stay visually distinguishable.
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("RentNotice Pro")
        .inner_size(1280.0, 860.0)
        .min_inner_size(1100.0, 700.0)
        .build()?;
    Ok(())
}

/// The window a menu action should apply to: the most recently focused one,
/// falling back to "main", then to any open window.
fn focused_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    let label = app
        .state::<MenuState>()
        .focused_label
        .lock()
        .unwrap()
        .clone();
    if !label.is_empty() {
        if let Some(win) = app.get_webview_window(&label) {
            return Some(win);
        }
    }
    app.get_webview_window("main")
        .or_else(|| app.webview_windows().values().next().cloned())
}

/// Accelerators live here so the unit test below can verify every string
/// parses — an invalid accelerator would otherwise fail menu construction at
/// app startup (there is no compile-time check).
const ACCEL_SETTINGS: &str = "CmdOrCtrl+,";
const ACCEL_NEW_NOTICE: &str = "CmdOrCtrl+N";
const ACCEL_IMPORT: &str = "CmdOrCtrl+I";
const ACCEL_NEW_WINDOW: &str = "CmdOrCtrl+Shift+N";
const ACCEL_ZOOM_IN: &str = "CmdOrCtrl+=";
const ACCEL_ZOOM_OUT: &str = "CmdOrCtrl+-";
const ACCEL_ZOOM_RESET: &str = "CmdOrCtrl+0";

/// View-menu navigation sections: (menu id, label, accelerator).
const NAV_SECTIONS: [(&str, &str, &str); 7] = [
    ("nav:/", "Dashboard", "CmdOrCtrl+1"),
    ("nav:/notices", "Notices", "CmdOrCtrl+2"),
    ("nav:/calendar", "Calendar", "CmdOrCtrl+3"),
    ("nav:/properties", "Properties", "CmdOrCtrl+4"),
    ("nav:/tenants", "Tenants", "CmdOrCtrl+5"),
    ("nav:/communications", "Communications", "CmdOrCtrl+6"),
    ("nav:/reports", "Reports", "CmdOrCtrl+7"),
];

/// Builds the native menu bar. Menu ids use prefixes routed by
/// `handle_menu_event`: `nav:<route>` navigates the focused window,
/// `zoom:<op>` adjusts its webview zoom, `win:new` opens a window.
fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // macOS app menu ("RentNotice Pro"): About, Settings…, standard items.
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(handle, "RentNotice Pro")
        .about(None)
        .separator()
        .item(
            &MenuItemBuilder::with_id("nav:/settings", "Settings…")
                .accelerator(ACCEL_SETTINGS)
                .build(handle)?,
        )
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let mut file = SubmenuBuilder::new(handle, "File")
        .item(
            &MenuItemBuilder::with_id("nav:/notices/new", "New Notice")
                .accelerator(ACCEL_NEW_NOTICE)
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav:/import", "Import Ledger…")
                .accelerator(ACCEL_IMPORT)
                .build(handle)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("win:new", "New Window")
                .accelerator(ACCEL_NEW_WINDOW)
                .build(handle)?,
        );
    // Windows/Linux have no app menu; Settings lives under File there.
    #[cfg(not(target_os = "macos"))]
    {
        file = file.separator().item(
            &MenuItemBuilder::with_id("nav:/settings", "Settings…")
                .accelerator(ACCEL_SETTINGS)
                .build(handle)?,
        );
    }
    let file = file.separator().close_window().build()?;

    // Predefined clipboard items are required once a custom menu replaces the
    // default one — without them Cmd+C/V/X/Z die in the macOS WKWebView.
    let edit = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let mut view = SubmenuBuilder::new(handle, "View")
        .item(
            &MenuItemBuilder::with_id("zoom:in", "Zoom In")
                .accelerator(ACCEL_ZOOM_IN)
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom:out", "Zoom Out")
                .accelerator(ACCEL_ZOOM_OUT)
                .build(handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom:reset", "Actual Size")
                .accelerator(ACCEL_ZOOM_RESET)
                .build(handle)?,
        )
        .separator();
    for (id, label, accel) in NAV_SECTIONS {
        view = view.item(&MenuItemBuilder::with_id(id, label).accelerator(accel).build(handle)?);
    }
    #[cfg(target_os = "macos")]
    {
        view = view
            .separator()
            .item(&tauri::menu::PredefinedMenuItem::fullscreen(handle, None)?);
    }
    let view = view.build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .build()?;
    // macOS then appends and maintains the open-window list automatically.
    #[cfg(target_os = "macos")]
    window_menu.set_as_windows_menu_for_nsapp()?;

    let menu = MenuBuilder::new(handle);
    // Shadow rather than mutate: the reassignment only exists on macOS.
    #[cfg(target_os = "macos")]
    let menu = menu.item(&app_menu);
    menu.items(&[&file, &edit, &view, &window_menu]).build()
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(route) = id.strip_prefix("nav:") {
        if let Some(win) = focused_window(app) {
            // emit_to targets only the focused window; other windows keep
            // their own location.
            let _ = app.emit_to(win.label(), "menu:navigate", route);
        }
    } else if id == "win:new" {
        let _ = open_aux_window(app, None);
    } else if let Some(op) = id.strip_prefix("zoom:") {
        if let Some(win) = focused_window(app) {
            let state = app.state::<MenuState>();
            let mut zoom = state.zoom.lock().unwrap();
            let current = *zoom.get(win.label()).unwrap_or(&1.0);
            let next = match op {
                "in" => (current + 0.1).min(2.0),
                "out" => (current - 0.1).max(0.5),
                _ => 1.0,
            };
            let next = (next * 100.0).round() / 100.0;
            if win.set_zoom(next).is_ok() {
                zoom.insert(win.label().to_string(), next);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the auto-updater plugin is intentionally not registered in v1 —
    // installed apps must never contact a placeholder update endpoint.
    // See BUILDING.md §4 for how to re-enable it with real signing keys.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(MenuState::default())
        .menu(build_menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            match event {
                WindowEvent::Focused(true) => {
                    let state = window.app_handle().state::<MenuState>();
                    *state.focused_label.lock().unwrap() = window.label().to_string();
                }
                WindowEvent::Destroyed => {
                    // Drop per-window bookkeeping so closed windows don't leak
                    // zoom factors or unconsumed deep-link routes.
                    let state = window.app_handle().state::<MenuState>();
                    state.zoom.lock().unwrap().remove(window.label());
                    state.pending_routes.lock().unwrap().remove(window.label());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_file,
            app_info,
            save_installer,
            open_window,
            take_initial_route
        ])
        .run(tauri::generate_context!())
        .expect("error while running RentNotice Pro");
}

#[cfg(test)]
mod tests {
    use super::{ACCEL_IMPORT, ACCEL_NEW_NOTICE, ACCEL_NEW_WINDOW, ACCEL_SETTINGS, ACCEL_ZOOM_IN, ACCEL_ZOOM_OUT, ACCEL_ZOOM_RESET, NAV_SECTIONS};
    use std::str::FromStr;

    /// Accelerator strings parse at menu build time, not compile time — a bad
    /// one would abort app startup. muda is the parser tauri uses internally.
    #[test]
    fn all_menu_accelerators_parse() {
        let mut accels = vec![
            ACCEL_SETTINGS,
            ACCEL_NEW_NOTICE,
            ACCEL_IMPORT,
            ACCEL_NEW_WINDOW,
            ACCEL_ZOOM_IN,
            ACCEL_ZOOM_OUT,
            ACCEL_ZOOM_RESET,
        ];
        accels.extend(NAV_SECTIONS.iter().map(|(_, _, a)| *a));
        for accel in accels {
            muda::accelerator::Accelerator::from_str(accel)
                .unwrap_or_else(|e| panic!("accelerator {accel:?} failed to parse: {e}"));
        }
    }
}
