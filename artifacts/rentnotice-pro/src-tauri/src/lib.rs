#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the auto-updater plugin is intentionally not registered in v1 —
    // installed apps must never contact a placeholder update endpoint.
    // See BUILDING.md §4 for how to re-enable it with real signing keys.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running RentNotice Pro");
}
