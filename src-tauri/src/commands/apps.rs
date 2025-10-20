use crate::config::save_app_config;
use crate::models::{AppInfo, IpaFileInfo, VersionInfo};
use crate::state::AppState;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn search_apps(query: String) -> Result<Vec<AppInfo>, String> {
    let output = Command::new("ipatool")
        .args(&["search", &query, "--limit", "50"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let apps: Vec<AppInfo> = serde_json::from_str(&stdout).unwrap_or_else(|_| Vec::new());
        Ok(apps)
    } else {
        Err("Search failed".to_string())
    }
}

#[tauri::command]
pub async fn get_app_versions(bundle_id: String) -> Result<Vec<VersionInfo>, String> {
    let output = Command::new("ipatool")
        .args(&["search", &bundle_id, "--limit", "1"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let versions: Vec<VersionInfo> =
            serde_json::from_str(&stdout).unwrap_or_else(|_| Vec::new());
        Ok(versions)
    } else {
        Err("Failed to get versions".to_string())
    }
}

#[tauri::command]
pub async fn download_ipa(
    bundle_id: String,
    app_name: String,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    let download_dir = state.download_dir.lock().unwrap().clone();

    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;

    window
        .emit(
            "download-progress",
            serde_json::json!({
                "status": "downloading",
                "progress": 0,
                "message": format!("Starting download of {}", app_name),
                "appName": app_name
            }),
        )
        .map_err(|e| e.to_string())?;

    let output = Command::new("ipatool")
        .args(&["download", "-b", &bundle_id, "-o", &download_dir])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        window
            .emit(
                "download-progress",
                serde_json::json!({
                    "status": "completed",
                    "progress": 100,
                    "message": format!("{} downloaded successfully", app_name),
                    "appName": app_name
                }),
            )
            .map_err(|e| e.to_string())?;

        Ok(format!("Downloaded {} to {}", bundle_id, download_dir))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        window
            .emit(
                "download-progress",
                serde_json::json!({
                    "status": "failed",
                    "progress": 0,
                    "message": format!("Download failed: {}", stderr),
                    "appName": app_name
                }),
            )
            .map_err(|e| e.to_string())?;

        Err(stderr.to_string())
    }
}

#[tauri::command]
pub async fn get_downloaded_ipas(state: State<'_, AppState>) -> Result<Vec<IpaFileInfo>, String> {
    let download_dir = state.download_dir.lock().unwrap().clone();
    let path = PathBuf::from(&download_dir);

    if !path.exists() {
        return Ok(Vec::new());
    }


    let mut ipas = Vec::new();

    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    if let Some(extension) = entry.path().extension() {
                        if extension == "ipa" {
                            if let Some(file_name) = entry.file_name().to_str() {
                                ipas.push(IpaFileInfo {
                                    name: file_name.to_string(),
                                    path: entry.path().to_string_lossy().to_string(),
                                    size: metadata.len(),
                                    bundle_id: String::new(),
                                    version: String::new(),
                                    download_date: String::new(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ipas)
}

#[tauri::command]
pub async fn set_download_directory(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    *state.download_dir.lock().unwrap() = path.clone();
    save_app_config(&state, None, Some(path.clone()), None)?;
    
    if std::path::Path::new(&path).exists() {
        if let Err(e) = crate::file_watcher::start_watching(app, path) {
            log::error!("Failed to restart file watcher: {:?}", e);
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn get_download_directory(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.download_dir.lock().unwrap().clone())
}

#[tauri::command]
pub async fn delete_ipa(path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    
    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }
    
    if !file_path.is_file() {
        return Err("Path is not a file".to_string());
    }
    
    if let Some(extension) = file_path.extension() {
        if extension != "ipa" {
            return Err("Only IPA files can be deleted".to_string());
        }
    } else {
        return Err("File has no extension".to_string());
    }
    
    fs::remove_file(file_path).map_err(|e| e.to_string())?;
    Ok(())
}
