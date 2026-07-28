use crate::config::save_app_config;
use crate::models::AppSettings;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().unwrap().clone();
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    *state.settings.lock().unwrap() = settings.clone();
    
    save_app_config(
        &state,
        None,
        None,
        None,
    )?;
    
    Ok(())
}

#[tauri::command]
pub fn open_config_directory(state: State<'_, AppState>) -> Result<(), String> {
    let config_dir = state.config_file.parent()
        .ok_or_else(|| "Failed to get config directory".to_string())?;
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(config_dir)
            .spawn()
            .map_err(|e| format!("Failed to open config directory: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(config_dir)
            .spawn()
            .map_err(|e| format!("Failed to open config directory: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(config_dir)
            .spawn()
            .map_err(|e| format!("Failed to open config directory: {}", e))?;
    }
    
    Ok(())
}



