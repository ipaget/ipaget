use std::path::PathBuf;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileStats {
    pub size: u64,
    pub modified: Option<String>,
}

#[tauri::command]
pub fn get_file_stats(path: String) -> Result<FileStats, String> {
    let file_path = PathBuf::from(&path);
    
    let metadata = std::fs::metadata(&file_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    
    let modified = metadata.modified()
        .ok()
        .and_then(|time| {
            let dt: chrono::DateTime<chrono::Local> = time.into();
            Some(dt.to_rfc3339())
        });
    
    Ok(FileStats {
        size: metadata.len(),
        modified,
    })
}

#[tauri::command]
pub fn get_download_dir() -> Result<String, String> {
    dirs::download_dir()
        .ok_or_else(|| "Failed to get download directory".to_string())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !path_buf.exists() {
        return Err(format!("File not found: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path_buf.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {}", e))?;
        }
    }

    Ok(())
}

