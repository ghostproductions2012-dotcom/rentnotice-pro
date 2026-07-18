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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the auto-updater plugin is intentionally not registered in v1 —
    // installed apps must never contact a placeholder update endpoint.
    // See BUILDING.md §4 for how to re-enable it with real signing keys.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running RentNotice Pro");
}
