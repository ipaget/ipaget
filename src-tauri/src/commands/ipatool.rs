use std::process::Command;
use tauri::Emitter;

#[tauri::command]
pub async fn check_ipatool() -> Result<bool, String> {
    let output = Command::new("ipatool").arg("--version").output();

    match output {
        Ok(result) => Ok(result.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn download_ipatool(window: tauri::Window) -> Result<String, String> {
    window
        .emit(
            "download-progress",
            serde_json::json!({
                "status": "downloading",
                "message": "Downloading ipatool..."
            }),
        )
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(&[
                "-Command",
                "irm https://github.com/majd/ipatool/releases/latest/download/ipatool-windows-amd64.zip -OutFile ipatool.zip; Expand-Archive -Path ipatool.zip -DestinationPath ."
            ])
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            window
                .emit(
                    "download-progress",
                    serde_json::json!({
                        "status": "completed",
                        "message": "ipatool downloaded successfully"
                    }),
                )
                .map_err(|e| e.to_string())?;
            Ok("ipatool downloaded successfully".to_string())
        } else {
            Err("Failed to download ipatool".to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("This platform is not supported yet".to_string())
    }
}
