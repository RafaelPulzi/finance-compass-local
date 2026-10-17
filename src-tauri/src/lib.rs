use tauri_plugin_fs::FsExt;

/// Grant the webview read/write access to a vault folder the user picked.
///
/// The static capability only covers the default vault inside app data. A folder
/// chosen through the dialog isn't known at compile time, so it has to be added
/// to the filesystem scope at runtime — and again on every launch, because that
/// scope lives in memory and isn't persisted.
#[tauri::command]
fn allow_vault_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
  app
    .fs_scope()
    .allow_directory(&path, true)
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![allow_vault_dir])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
