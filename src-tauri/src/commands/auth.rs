use crate::config::save_app_config;
use crate::models::{AccountInfo, SavedAccount};
use crate::state::AppState;
use std::process::Command;
use tauri::State;

fn save_account_to_list(state: &State<AppState>, email: &str, country: &str) {
    let mut accounts = state.saved_accounts.lock().unwrap();

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if let Some(account) = accounts.iter_mut().find(|a| a.email == email) {
        account.last_login = now;
        account.country = country.to_string();
    } else {
        accounts.push(SavedAccount {
            email: email.to_string(),
            country: country.to_string(),
            last_login: now,
        });
    }

    let accounts_clone = accounts.clone();
    drop(accounts);

    save_app_config(state, None, None, Some(accounts_clone)).ok();
}

#[tauri::command]
pub async fn login_apple(
    email: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let output = Command::new("ipatool")
        .args(&[
            "auth",
            "login",
            "-e",
            &email,
            "-p",
            &password,
            "--non-interactive",
            "--format",
            "json",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        *state.is_authenticated.lock().unwrap() = true;

        if let Ok(info) = get_account_info(state.clone()).await {
            save_account_to_list(&state, &info.email, &info.country);
        }

        Ok("SUCCESS".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);

        if stderr.contains("auth code") || stderr.contains("two-factor") || stderr.contains("2FA") {
            return Ok("2FA_REQUIRED".to_string());
        }

        Err(stderr.to_string())
    }
}

#[tauri::command]
pub async fn verify_2fa(
    email: String,
    password: String,
    code: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let output = Command::new("ipatool")
        .args(&[
            "auth",
            "login",
            "-e",
            &email,
            "-p",
            &password,
            "--auth-code",
            &code,
            "--non-interactive",
            "--format",
            "json",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        *state.is_authenticated.lock().unwrap() = true;

        if let Ok(info) = get_account_info(state.clone()).await {
            save_account_to_list(&state, &info.email, &info.country);
        }

        Ok("SUCCESS".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.to_string())
    }
}

#[tauri::command]
pub async fn check_auth_status(state: State<'_, AppState>) -> Result<bool, String> {
    let output = Command::new("ipatool")
        .args(&["auth", "info"])
        .output()
        .map_err(|e| e.to_string())?;

    let is_auth = output.status.success();
    *state.is_authenticated.lock().unwrap() = is_auth;
    Ok(is_auth)
}

#[tauri::command]
pub async fn get_account_info(state: State<'_, AppState>) -> Result<AccountInfo, String> {
    let output = Command::new("ipatool")
        .args(&["auth", "info", "--format", "json"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Ok(mut info) = serde_json::from_str::<AccountInfo>(&stdout) {
            info.is_authenticated = true;
            *state.is_authenticated.lock().unwrap() = true;
            return Ok(info);
        }
    }

    Ok(AccountInfo {
        email: String::new(),
        country: String::new(),
        is_authenticated: false,
    })
}

#[tauri::command]
pub async fn get_saved_accounts(state: State<'_, AppState>) -> Result<Vec<SavedAccount>, String> {
    let accounts = state.saved_accounts.lock().unwrap();
    Ok(accounts.clone())
}

#[tauri::command]
pub async fn logout_apple(state: State<'_, AppState>) -> Result<String, String> {
    let output = Command::new("ipatool")
        .args(&["auth", "revoke"])
        .output()
        .map_err(|e| e.to_string())?;

    *state.is_authenticated.lock().unwrap() = false;

    if output.status.success() {
        Ok("Logged out successfully".to_string())
    } else {
        Ok("Logged out".to_string())
    }
}

#[tauri::command]
pub async fn remove_saved_account(
    email: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut accounts = state.saved_accounts.lock().unwrap();
    accounts.retain(|a| a.email != email);

    let accounts_clone = accounts.clone();
    drop(accounts);

    save_app_config(&state, None, None, Some(accounts_clone))?;

    Ok("Account removed".to_string())
}
