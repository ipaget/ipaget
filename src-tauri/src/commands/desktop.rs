use arboard::{Clipboard, ImageData};
use std::borrow::Cow;
use std::fs;
use xcap::Monitor;

#[tauri::command]
pub fn open_text_in_default_editor(content: String) -> Result<(), String> {
    let path = std::env::temp_dir().join(format!(
        "ipaget-device-data-{}.txt",
        std::process::id()
    ));
    fs::write(&path, content).map_err(|error| format!("Failed to write device data: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&path)
            .spawn()
            .map_err(|error| format!("Failed to open default text editor: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("Failed to open default text editor: {error}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
                .map_err(|error| format!("Failed to open default text editor: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn capture_primary_screen_to_clipboard() -> Result<(), String> {
    let monitors = Monitor::all().map_err(|error| format!("Failed to list monitors: {error}"))?;
    let monitor = monitors
        .iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "No monitor found".to_string())?;
    let image = monitor
        .capture_image()
        .map_err(|error| format!("Failed to capture primary screen: {error}"))?;
    let mut clipboard = Clipboard::new().map_err(|error| format!("Failed to access clipboard: {error}"))?;
    clipboard
        .set_image(ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: Cow::Owned(image.into_raw()),
        })
        .map_err(|error| format!("Failed to copy screenshot: {error}"))
}

