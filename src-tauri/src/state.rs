use crate::models::{AppSettings, SavedAccount};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

pub struct AppState {
    pub download_dir: Mutex<String>,
    pub saved_accounts: Mutex<Vec<SavedAccount>>,
    pub settings: Mutex<AppSettings>,
    pub config_file: PathBuf,
    pub go_ios_path: Mutex<Option<PathBuf>>,
    pub go_service_process: Mutex<Option<Child>>,
    pub go_service_port: u16,
    pub selected_account_email: Mutex<Option<String>>,
}
