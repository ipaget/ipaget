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
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("iPAGet");

    fs::create_dir_all(&config_dir).ok();
    let config_file = config_dir.join("config.json");

    let config = load_app_config(&config_file);
    let go_ios_path = config.go_ios_path.map(|s| PathBuf::from(s));

    let app_state = AppState {
        is_authenticated: Mutex::new(false),
        download_dir: Mutex::new(config.download_dir),
        saved_accounts: Mutex::new(config.saved_accounts),
        config_file,
        go_ios_path: Mutex::new(go_ios_path),
        go_service_process: Mutex::new(None),
        go_service_port: 8765,
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
            // Start file watcher for download directory
            let state = app.state::<AppState>();
            let download_dir = state.download_dir.lock().unwrap().clone();
            if std::path::Path::new(&download_dir).exists() {
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
                    let app = window.app_handle();
                    tauri::async_runtime::spawn(async move {
                        let _ = stop_go_service(app).await;
                    });
                }
                #[cfg(debug_assertions)]
                {
                    let _ = window;
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_ipatool,
            download_ipatool,
            start_go_service,
            stop_go_service,
            is_go_service_running,
            get_go_service_url,
            login_apple,
            verify_2fa,
            check_auth_status,
            get_account_info,
            get_saved_accounts,
            logout_apple,
            remove_saved_account,
            search_apps,
            get_app_versions,
            download_ipa,
            get_downloaded_ipas,
            set_download_directory,
            get_download_directory,
            delete_ipa,
            is_dev_mode,
            open_main_window,
            create_installer_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
