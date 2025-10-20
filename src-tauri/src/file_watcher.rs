use notify::{Watcher, RecursiveMode, Result as NotifyResult, Event};
use std::path::Path;
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn start_watching<P: AsRef<Path>>(app_handle: AppHandle, path: P) -> NotifyResult<()> {
    let path = path.as_ref().to_path_buf();
    
    std::thread::spawn(move || {
        let (tx, rx) = channel();
        
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                log::error!("Failed to create watcher: {:?}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&path, RecursiveMode::NonRecursive) {
            log::error!("Failed to watch directory: {:?}", e);
            return;
        }

        log::info!("File watcher started for: {:?}", path);

        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    handle_file_event(&app_handle, event);
                }
                Ok(Err(e)) => {
                    log::error!("Watch error: {:?}", e);
                }
                Err(_) => {
                    // Timeout, continue loop
                }
            }
        }
    });

    Ok(())
}

fn handle_file_event(app_handle: &AppHandle, event: Event) {
    use notify::EventKind;
    
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
            // Check if any path is an IPA file
            for path in event.paths {
                if let Some(extension) = path.extension() {
                    if extension == "ipa" {
                        log::info!("IPA file change detected: {:?}", path);
                        if let Err(e) = app_handle.emit("download-directory-changed", ()) {
                            log::error!("Failed to emit file change event: {:?}", e);
                        }
                        break;
                    }
                }
            }
        }
        _ => {}
    }
}

