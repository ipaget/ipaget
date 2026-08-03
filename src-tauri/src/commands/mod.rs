pub mod apps;
pub mod file_system;
pub mod go_service;
pub mod settings;
pub mod window;

pub use apps::*;
pub use file_system::*;
pub use go_service::*;
pub use settings::*;
pub use window::*;

#[tauri::command]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}
