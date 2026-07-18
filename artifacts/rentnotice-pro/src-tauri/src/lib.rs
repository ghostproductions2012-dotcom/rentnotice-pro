use tauri_plugin_dialog::DialogExt;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the auto-updater plugin is intentionally not registered in v1 —
    // installed apps must never contact a placeholder update endpoint.
    // See BUILDING.md §4 for how to re-enable it with real signing keys.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_file, app_info, save_installer])
        .run(tauri::generate_context!())
        .expect("error while running RentNotice Pro");
}
