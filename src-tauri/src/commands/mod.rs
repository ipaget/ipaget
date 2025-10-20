pub mod apps;
pub mod auth;
pub mod go_service;
pub mod ipatool;
pub mod window;

pub use apps::*;
pub use auth::*;
pub use go_service::*;
pub use ipatool::*;
pub use window::*;

#[tauri::command]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}
