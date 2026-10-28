use serde::{Deserialize, Serialize};

pub const DEFAULT_ANISETTE_URL: &str = "https://new.ani.sidestore.io";

fn default_anisette_url() -> String {
    DEFAULT_ANISETTE_URL.to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpaFileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub bundle_id: String,
    pub version: String,
    pub download_date: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedAccount {
    pub email: String,
    pub country: String,
    pub last_login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub language: String,
    #[serde(default = "default_anisette_url")]
    pub anisette_url: String,
    #[serde(default)]
    pub proxy_url: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            anisette_url: default_anisette_url(),
            proxy_url: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub go_ios_path: Option<String>,
    pub download_dir: String,
    pub saved_accounts: Vec<SavedAccount>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub selected_account_email: Option<String>,
}
