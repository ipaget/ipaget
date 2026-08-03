use crate::config::save_app_config;
use crate::models::{IpaFileInfo, SavedAccount};
use crate::state::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::State;
use tauri_plugin_fs::FsExt;

fn is_supported_ipa_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "ipa" | "tipa"))
        .unwrap_or(false)
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
                    if is_supported_ipa_extension(&entry.path()) {
                        if let Some(file_name) = entry.file_name().to_str() {
                            // Try to read file modification time
                            let download_date = match metadata.modified() {
                                Ok(modified) => {
                                    // Convert to RFC3339 string for easy parsing on frontend
                                    let dt: chrono::DateTime<chrono::Local> = modified.into();
                                    dt.to_rfc3339()
                                },
                                Err(_) => String::new(),
                            };

                            ipas.push(IpaFileInfo {
                                name: file_name.to_string(),
                                path: entry.path().to_string_lossy().to_string(),
                                size: metadata.len(),
                                bundle_id: String::new(),
                                version: String::new(),
                                download_date,
                                source: "native".to_string(),
                            });
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
        // Add the new download directory to file system scope
        let download_path = PathBuf::from(&path);
        if let Err(e) = app.fs_scope().allow_directory(&download_path, true) {
            log::error!("Failed to add download directory to scope: {:?}", e);
        } else {
            log::info!("Added download directory to scope: {}", download_path.display());
        }
        
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
    
    if !is_supported_ipa_extension(&file_path) {
        return Err("Only IPA or TIPA files can be deleted".to_string());
    }
    
    fs::remove_file(file_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn import_ipa_files(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<IpaFileInfo>, String> {
    let download_dir = state.download_dir.lock().unwrap().clone();
    let target_dir = PathBuf::from(&download_dir);

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    if let Err(e) = app.fs_scope().allow_directory(&target_dir, true) {
        log::error!("Failed to add download directory to scope: {:?}", e);
    }

    let mut imported = Vec::new();

    for source in paths {
        let source_path = PathBuf::from(&source);

        if !source_path.exists() || !source_path.is_file() {
            return Err(format!("File does not exist: {}", source));
        }

        if !is_supported_ipa_extension(&source_path) {
            return Err(format!("Only IPA or TIPA files are supported: {}", source));
        }

        let file_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Invalid file name: {}", source))?
            .to_string();

        let target_path = target_dir.join(&file_name);

        if source_path != target_path {
            fs::copy(&source_path, &target_path).map_err(|e| e.to_string())?;
        }

        let metadata = fs::metadata(&target_path).map_err(|e| e.to_string())?;
        let download_date = match metadata.modified() {
            Ok(modified) => {
                let dt: chrono::DateTime<chrono::Local> = modified.into();
                dt.to_rfc3339()
            }
            Err(_) => String::new(),
        };

        imported.push(IpaFileInfo {
            name: file_name,
            path: target_path.to_string_lossy().to_string(),
            size: metadata.len(),
            bundle_id: String::new(),
            version: String::new(),
            download_date,
            source: "native".to_string(),
        });
    }

    Ok(imported)
}

#[tauri::command]
pub async fn get_saved_accounts(state: State<'_, AppState>) -> Result<Vec<SavedAccount>, String> {
    let accounts = state.saved_accounts.lock().unwrap();
    Ok(accounts.clone())
}

#[tauri::command]
pub async fn save_account(
    email: String,
    country: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut accounts = state.saved_accounts.lock().unwrap();
    
    // Check if account already exists
    if let Some(account) = accounts.iter_mut().find(|a| a.email == email) {
        // Update existing account
        account.country = country.clone();
        account.last_login = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    } else {
        // Add new account
        accounts.push(SavedAccount {
            email: email.clone(),
            country: country.clone(),
            last_login: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        });
    }
    
    // Save to config file
    let accounts_clone = accounts.clone();
    drop(accounts); // Release lock before saving config
    crate::config::save_app_config(&state, None, None, Some(accounts_clone))
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn remove_saved_account(
    email: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut accounts = state.saved_accounts.lock().unwrap();
    accounts.retain(|a| a.email != email);
    
    // Save to config file
    let accounts_clone = accounts.clone();
    drop(accounts); // Release lock before saving config
    crate::config::save_app_config(&state, None, None, Some(accounts_clone))
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn logout_apple(_state: State<'_, AppState>) -> Result<(), String> {
    // Currently just a placeholder - actual logout is handled by go-service
    // We keep the account in saved_accounts for quick re-login
    Ok(())
}
