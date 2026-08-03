// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod models;
mod state;
mod file_watcher;

use commands::*;
use config::load_app_config;
use state::AppState;
use std::fs;
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

fn main() {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("iPAGet");

    fs::create_dir_all(&config_dir).ok();
    let config_file = config_dir.join("config.json");

    let config = load_app_config(&config_file);
    let go_ios_path = config.go_ios_path.map(|s| PathBuf::from(s));

    // Decide service port: dev uses 8765 without checking; prod checks 127.0.0.1:8765 and falls back to a random available port
    let selected_port: u16 = {
        #[cfg(debug_assertions)]
        {
            8765
        }
        #[cfg(not(debug_assertions))]
        {
            let default_port: u16 = 8765;
            if is_port_free(default_port) {
                default_port
            } else {
                find_available_port(20000, 60000).unwrap_or(default_port)
            }
        }
    };

    let app_state = AppState {
        download_dir: Mutex::new(config.download_dir),
        saved_accounts: Mutex::new(config.saved_accounts),
        settings: Mutex::new(config.settings),
        config_file,
        go_ios_path: Mutex::new(go_ios_path),
        go_service_process: Mutex::new(None),
        go_service_port: selected_port,
        selected_account_email: Mutex::new(config.selected_account_email),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .setup(|app| {
            // Add config directory to file system scope
            let config_dir = dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("iPAGet");
            
            if let Err(e) = app.fs_scope().allow_directory(&config_dir, true) {
                log::error!("Failed to add config directory to scope: {:?}", e);
            } else {
                log::info!("Added config directory to scope: {}", config_dir.display());
            }
            
            // Start file watcher for download directory
            let state = app.state::<AppState>();
            let download_dir = state.download_dir.lock().unwrap().clone();
            let download_path = PathBuf::from(&download_dir);
            
            if download_path.exists() {
                // Add download directory to file system scope
                if let Err(e) = app.fs_scope().allow_directory(&download_path, true) {
                    log::error!("Failed to add download directory to scope: {:?}", e);
                } else {
                    log::info!("Added download directory to scope: {}", download_path.display());
                }
                
                let app_handle = app.handle().clone();
                if let Err(e) = file_watcher::start_watching(app_handle, download_dir) {
                    log::error!("Failed to start file watcher: {:?}", e);
                }
            }
            
            // Handle file opened via file association (command line args)
            let args: Vec<String> = std::env::args().collect();
            let mut has_ipa_file = false;
            
            if args.len() > 1 {
                for arg in &args[1..] {
                    if arg.ends_with(".ipa") {
                        log::info!("IPA file opened via association: {}", arg);
                        has_ipa_file = true;
                        
                        // Add the IPA file's parent directory to scope
                        let ipa_path = PathBuf::from(arg);
                        if let Some(parent_dir) = ipa_path.parent() {
                            if let Err(e) = app.fs_scope().allow_directory(parent_dir, true) {
                                log::error!("Failed to add IPA directory to scope: {:?}", e);
                            } else {
                                log::info!("Added IPA directory to scope: {}", parent_dir.display());
                            }
                        }
                        
                        // Create installer window instead of main window
                        if let Err(e) = create_installer_window(app.handle().clone(), arg.clone()) {
                            log::error!("Failed to create installer window: {}", e);
                        }
                    }
                }
            }

            // Only create main window if no IPA file was opened
            if !has_ipa_file {
                if let Err(e) = tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("/".into())
                )
                .title("iPAGet")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .resizable(true)
                .maximizable(false)
                .decorations(false)
                .build() {
                    log::error!("Failed to create main window: {}", e);
                }
            }

            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match start_go_service(handle).await {
                        Ok(port) => log::info!("Go service started on port {}", port),
                        Err(e) => log::error!("Failed to start Go service: {}", e),
                    }
                });
            }
            #[cfg(debug_assertions)]
            {
                let _ = app;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                #[cfg(not(debug_assertions))]
                {
                    let app_handle = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = stop_go_service(app_handle).await;
                    });
                }
                #[cfg(debug_assertions)]
                {
                    let _ = window;
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_go_service,
            stop_go_service,
            is_go_service_running,
            get_go_service_url,
            get_saved_accounts,
            save_account,
            remove_saved_account,
            logout_apple,
            get_downloaded_ipas,
            set_download_directory,
            get_download_directory,
            delete_ipa,
            import_ipa_files,
            is_dev_mode,
            open_main_window,
            create_installer_window,
            open_debug_window,
            get_settings,
            save_settings,
            open_config_directory,
            get_download_dir,
            show_in_folder,
            get_file_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(debug_assertions))]
fn is_port_free(port: u16) -> bool {
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(_) => false,
    }
}

#[cfg(not(debug_assertions))]
fn find_available_port(start: u16, end: u16) -> Option<u16> {
    if end <= start { return None; }
    let range = end - start;
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_millis() as u16;
    for i in 0..range {
        let candidate = start.saturating_add(((seed + i) % range) as u16);
        if is_port_free(candidate) {
            return Some(candidate);
        }
    }
    None
}
