use crate::state::AppState;
use log::info;
use tauri::{AppHandle, Manager};

use log::error;

use std::process::{Command, Stdio};

#[cfg(debug_assertions)]
use std::path::PathBuf;

#[tauri::command]
pub async fn start_go_service(app: AppHandle) -> Result<u16, String> {
    let state = app.state::<AppState>();

    let _start_lock = state.go_service_start_lock.lock().await;
    let port = state.go_service_port;
    {
        let process_lock = state.go_service_process.lock().unwrap();
        if process_lock.is_some() {
            return Ok(port);
        }
    }

        #[cfg(debug_assertions)]
        let mut cmd = {
            let service_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or("Failed to locate project directory")?
                .join("go-service");
            if !service_dir.exists() {
                return Err(format!("Go service directory not found at: {:?}", service_dir));
            }
            let mut command = Command::new("go");
            command
                .args(["run", "github.com/air-verse/air@v1.62.0"])
                .current_dir(service_dir);
            command
        };

        #[cfg(not(debug_assertions))]
        let mut cmd = {
        let service_path = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join("binaries")
            .join(get_service_binary_name());
        
        info!("Starting Go service from: {:?}", service_path);
        
        if !service_path.exists() {
            error!("Go service binary not found at: {:?}", service_path);
            return Err(format!("Go service binary not found at: {:?}", service_path));
        }
        Command::new(&service_path)
        };

        // Get config directory from AppState
        let config_dir = state.config_file
            .parent()
            .ok_or("Failed to get config directory")?
            .to_str()
            .ok_or("Failed to convert config directory to string")?;

        let proxy_url = state.settings.lock().unwrap().proxy_url.trim().to_string();
        
        cmd.env("PORT", port.to_string())
            .env("CONFIG_DIR", config_dir)  // Pass config directory to go-service
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if !proxy_url.is_empty() {
            info!("Starting Go service with outbound proxy: {}", proxy_url);
            cmd.env("HTTP_PROXY", &proxy_url)
                .env("HTTPS_PROXY", &proxy_url)
                .env("http_proxy", &proxy_url)
                .env("https_proxy", &proxy_url);
        }
        
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        
        let child = cmd.spawn().map_err(|e| {
            error!("Failed to start Go service: {}", e);
            format!("Failed to start Go service: {}", e)
        })?;
        
        // Store the process handle before releasing the lock so concurrent
        // frontend requests cannot spawn a second service.
        {
            let mut process_lock = state.go_service_process.lock().unwrap();
            *process_lock = Some(child);
        }
        
        info!("Go service process started, waiting for it to be ready...");
        
        // Poll health endpoint until service is ready
        let health_url = format!("http://127.0.0.1:{}/health", port);
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|e| format!("Failed to create health check client: {}", e))?;
        let max_attempts = 30; // 30 attempts * 200ms = 6 seconds max
        let mut ready = false;
        
        for attempt in 1..=max_attempts {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            
            match client.get(&health_url).timeout(std::time::Duration::from_millis(500)).send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        if let Ok(json) = response.json::<serde_json::Value>().await {
                            if json.get("ready").and_then(|v| v.as_bool()).unwrap_or(false) {
                                info!("Go service is ready after {} attempts", attempt);
                                ready = true;
                                break;
                            }
                        }
                    }
                }
                Err(_) => {
                    // Service not ready yet, continue polling
                }
            }
        }
        
        if !ready {
            let child = {
                let mut process_lock = state.go_service_process.lock().unwrap();
                process_lock.take()
            };
            if let Some(mut child) = child {
                let _ = child.kill();
                let _ = child.wait();
            }
            error!("Go service failed to become ready after {} attempts", max_attempts);
            return Err("Go service failed to become ready in time".to_string());
        }
        
    info!("Go service started successfully on port {}", port);
    Ok(port)
}

#[tauri::command]
pub async fn stop_go_service(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut process_lock = state.go_service_process.lock().unwrap();
    
    if let Some(mut child) = process_lock.take() {
        info!("Stopping Go service...");
        
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            let _ = child.kill();
        }
        
        let _ = child.wait();
        info!("Go service stopped");
    }
    
    Ok(())
}

#[tauri::command]
pub fn is_go_service_running(app: AppHandle) -> bool {
    let state = app.state::<AppState>();
    let process_lock = state.go_service_process.lock().unwrap();
    process_lock.is_some()
}

#[tauri::command]
pub fn get_go_service_url(app: AppHandle) -> String {
    let state = app.state::<AppState>();
    // Use IPv4 loopback explicitly. "localhost" may resolve to ::1 first and
    // fail or hang when the service is bound to 127.0.0.1 only.
    format!("http://127.0.0.1:{}", state.go_service_port)
}

#[cfg(not(debug_assertions))]
fn get_service_binary_name() -> String {
    if cfg!(target_os = "windows") {
        "ipaget-service.exe".to_string()
    } else {
        "ipaget-service".to_string()
    }
}
