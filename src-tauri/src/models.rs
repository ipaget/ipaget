use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub bundle_id: String,
    pub name: String,
    pub version: String,
    pub icon_url: Option<String>,
    pub price: Option<f64>,
    pub description: Option<String>,
    pub rating: Option<f64>,
    pub download_count: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub release_date: String,
    pub size: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpaFileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub bundle_id: String,
    pub version: String,
    pub download_date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountInfo {
    pub email: String,
    pub country: String,
    pub is_authenticated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedAccount {
    pub email: String,
    pub country: String,
    pub last_login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub go_ios_path: Option<String>,
    pub download_dir: String,
    pub saved_accounts: Vec<SavedAccount>,
}
