use crate::state::AppState;
use log::info;
use tauri::{AppHandle, Manager};

#[cfg(not(debug_assertions))]
use log::error;

#[cfg(not(debug_assertions))]
use std::process::{Command, Stdio};

#[cfg(all(debug_assertions, target_os = "windows"))]
use std::process::Command;

#[tauri::command]
pub async fn start_go_service(app: AppHandle) -> Result<u16, String> {
    let state = app.state::<AppState>();
    
    // In development mode, assume service is already started by start-dev script
    #[cfg(debug_assertions)]
    {
        return Ok(state.go_service_port);
    }
    
    // Production mode: start the service if not already running
    #[cfg(not(debug_assertions))]
    {
        // Check if already running
        {
            let process_lock = state.go_service_process.lock().unwrap();
            if process_lock.is_some() {
                return Ok(state.go_service_port);
            }
        }
        
        let port = state.go_service_port;
        
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
        
        let mut cmd = Command::new(&service_path);
        cmd.env("PORT", port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        
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
        
        // Store the process handle
        {
            let mut process_lock = state.go_service_process.lock().unwrap();
            *process_lock = Some(child);
        }
        
        info!("Go service started on port {}", port);
        
        // Wait a bit for service to be ready (lock is already released)
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        return Ok(port);
    }
}

#[tauri::command]
pub async fn stop_go_service(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut process_lock = state.go_service_process.lock().unwrap();
    
    if let Some(mut child) = process_lock.take() {
        info!("Stopping Go service...");
        
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(&["/PID", &child.id().to_string(), "/F"])
                .output();
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
    format!("http://localhost:{}", state.go_service_port)
}

#[cfg(not(debug_assertions))]
fn get_service_binary_name() -> String {
    #[cfg(target_os = "windows")]
    return "ipaget-service-x86_64-pc-windows-msvc.exe".to_string();
    
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "ipaget-service-x86_64-apple-darwin".to_string();
    
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "ipaget-service-aarch64-apple-darwin".to_string();
    
    #[cfg(target_os = "linux")]
    return "ipaget-service-x86_64-unknown-linux-gnu".to_string();
}

