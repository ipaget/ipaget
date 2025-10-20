use crate::models::{AppConfig, SavedAccount};
use crate::state::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::State;

pub fn save_app_config(
    state: &State<'_, AppState>,
    go_ios_path: Option<String>,
    download_dir: Option<String>,
    saved_accounts: Option<Vec<SavedAccount>>,
) -> Result<(), String> {
    let current_go_ios_path = go_ios_path.or_else(|| {
        state
            .go_ios_path
            .lock()
            .unwrap()
            .as_ref()
            .map(|p| p.display().to_string())
    });

    let current_download_dir =
        download_dir.unwrap_or_else(|| state.download_dir.lock().unwrap().clone());

    let current_accounts =
        saved_accounts.unwrap_or_else(|| state.saved_accounts.lock().unwrap().clone());

    let config = AppConfig {
        go_ios_path: current_go_ios_path,
        download_dir: current_download_dir,
        saved_accounts: current_accounts,
    };

    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&state.config_file, config_json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    Ok(())
}

pub fn load_app_config(config_file: &PathBuf) -> AppConfig {
    if config_file.exists() {
        if let Ok(content) = fs::read_to_string(config_file) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }

    let default_download_dir = dirs::download_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("iPAGet")
        .to_string_lossy()
        .to_string();

    AppConfig {
        go_ios_path: None,
        download_dir: default_download_dir,
        saved_accounts: Vec::new(),
    }
}
