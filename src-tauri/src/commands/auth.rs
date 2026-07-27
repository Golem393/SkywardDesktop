use serde::{Deserialize, Serialize};

const DEFAULT_BACKEND_URL: &str = "https://mdm-backend-i4b0.onrender.com/api";
const DEFAULT_API_KEY: &str = "api_3d9a7c1f5b824e9aa4d6f7c8b1e2a3d4";

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub success: bool,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
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
