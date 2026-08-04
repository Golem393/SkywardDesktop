use crate::commands::config::{DEFAULT_API_KEY, DEFAULT_BACKEND_URL};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub success: bool,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
    /// Supabase session token, passed straight through to the frontend so it can
    /// authenticate its own schedule/device calls as this parent.
    #[serde(rename = "accessToken", default)]
    pub access_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct AuthRequest<'a> {
    email: &'a str,
    password: &'a str,
}

/// Tauri command: verify user credentials and check for an active Stripe subscription via the backend.
/// Reuses the existing `/api/setup-auth` endpoint from `mdm-backend`.
#[tauri::command]
pub async fn verify_subscription(email: String, password: String) -> Result<AuthResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/setup-auth", DEFAULT_BACKEND_URL);

    let res = client
        .post(&url)
        .header("x-api-key", DEFAULT_API_KEY)
        .json(&AuthRequest {
            email: &email,
            password: &password,
        })
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Backend returned HTTP {}", res.status()));
    }

    let body = res
        .json::<AuthResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(body)
}
