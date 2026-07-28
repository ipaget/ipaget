use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
pub async fn open_main_window(app: AppHandle) -> Result<(), String> {
    // Check if main window already exists
    if let Some(window) = app.get_webview_window("main") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Create main window
    tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("/".into())
    )
    .title("iPAGet")
    .inner_size(1200.0, 800.0)
    .min_inner_size(900.0, 600.0)
    .resizable(true)
    .maximizable(false)
    .decorations(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn create_installer_window(app: AppHandle, ipa_path: String) -> Result<(), String> {
    // Add the IPA file's parent directory to scope
    let ipa_file_path = PathBuf::from(&ipa_path);
    if let Some(parent_dir) = ipa_file_path.parent() {
        if let Err(e) = app.fs_scope().allow_directory(parent_dir, true) {
            log::error!("Failed to add IPA directory to scope: {:?}", e);
        } else {
            log::info!("Added IPA directory to scope: {}", parent_dir.display());
        }
    }
    
    // Generate unique window label using timestamp
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    
    // Create installer window
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        format!("installer-{}", timestamp),
        tauri::WebviewUrl::App("/installer".into())
    )
    .title("Install IPA - iPAGet")
    .inner_size(700.0, 800.0)
    .resizable(false)
    .maximizable(false)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    // Send IPA path to the installer window
    window.emit("ipa-path", ipa_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn open_debug_window(app: AppHandle) -> Result<(), String> {
    // Generate unique window label using timestamp
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();

    tauri::WebviewWindowBuilder::new(
        &app,
        format!("debug-{}", timestamp),
        tauri::WebviewUrl::App("/debug".into())
    )
    .title("Debug")
    .inner_size(1000.0, 700.0)
    .resizable(true)
    .maximizable(true)
    .decorations(false)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

