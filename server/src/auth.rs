use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreProviderMetadata, CoreTokenResponse,
};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope,
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

use crate::config::Config;
use crate::db::Db;
use crate::errors::AppError;
use crate::models::user::User;
use crate::services::users;

// ── OIDC client state ─────────────────────────────────────────────────────────

/// Fully-configured OIDC client after provider discovery + redirect URL
/// wiring. openidconnect 4 tracks endpoint-configuration state at the type
/// level, so we have to spell out the fully-set shape explicitly.
pub type OidcCoreClient = CoreClient<
    EndpointSet,      // HasAuthUrl
    EndpointNotSet,   // HasDeviceAuthUrl
    EndpointNotSet,   // HasIntrospectionUrl
    EndpointNotSet,   // HasRevocationUrl
    EndpointMaybeSet, // HasTokenUrl
    EndpointMaybeSet, // HasUserInfoUrl
>;

pub struct OidcState {
    pub client: OidcCoreClient,
    /// reqwest client dedicated to OIDC traffic. openidconnect 4 mandates
    /// `redirect::Policy::none()` to prevent SSRF-style attacks during token
    /// exchange, so we can't share the general-purpose client.
    pub http_client: reqwest::Client,
}

pub async fn build_oidc_client(config: &Config) -> anyhow::Result<OidcState> {
    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| anyhow::anyhow!("Failed to build OIDC HTTP client: {}", e))?;

    let issuer_url = IssuerUrl::new(config.auth_issuer.clone())?;

    let provider_metadata = CoreProviderMetadata::discover_async(issuer_url, &http_client)
        .await
        .map_err(|e| anyhow::anyhow!("OIDC discovery failed: {}", e))?;

    let redirect_url = format!("{}/auth/oauth2/callback", config.frontend_url);

    let client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(config.auth_client_id.clone()),
        Some(ClientSecret::new(config.auth_client_secret.clone())),
    )
    .set_redirect_uri(
        RedirectUrl::new(redirect_url)
            .map_err(|e| anyhow::anyhow!("Invalid redirect URL: {}", e))?,
    );

    Ok(OidcState {
        client,
        http_client,
    })
}

// ── Session keys ──────────────────────────────────────────────────────────────

pub const SESSION_USER_ID: &str = "user_id";
pub const SESSION_PKCE_VERIFIER: &str = "pkce_verifier";
pub const SESSION_CSRF_TOKEN: &str = "csrf_token";
pub const SESSION_NONCE: &str = "nonce";

// ── OAuth URL builder ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthStartData {
    pub auth_url: String,
    pub pkce_verifier: String,
    pub csrf_token: String,
    pub nonce: String,
}

pub fn build_auth_url(client: &OidcCoreClient) -> OAuthStartData {
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, csrf_token, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".into()))
        .add_scope(Scope::new("email".into()))
        .add_scope(Scope::new("profile".into()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    OAuthStartData {
        auth_url: auth_url.to_string(),
        pkce_verifier: pkce_verifier.secret().clone(),
        csrf_token: csrf_token.secret().clone(),
        nonce: nonce.secret().clone(),
    }
}

// ── Callback data ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: String,
    pub state: String,
}

pub struct CallbackUserInfo {
    pub provider_id: String,
    pub email: Option<String>,
    pub name: Option<String>,
}

pub async fn exchange_code_for_user(
    client: &OidcCoreClient,
    http_client: &reqwest::Client,
    code: String,
    pkce_verifier_secret: String,
    nonce_secret: String,
) -> anyhow::Result<CallbackUserInfo> {
    let pkce_verifier = PkceCodeVerifier::new(pkce_verifier_secret);
    let nonce = Nonce::new(nonce_secret);

    let token_response: CoreTokenResponse = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| anyhow::anyhow!("Exchange code endpoint not configured: {}", e))?
        .set_pkce_verifier(pkce_verifier)
        .request_async(http_client)
        .await
        .map_err(|e| anyhow::anyhow!("Token exchange failed: {}", e))?;

    let id_token = token_response
        .extra_fields()
        .id_token()
        .ok_or_else(|| anyhow::anyhow!("ID token missing from response"))?;

    let claims = id_token
        .claims(&client.id_token_verifier(), &nonce)
        .map_err(|e| anyhow::anyhow!("ID token verification failed: {}", e))?;

    let provider_id = claims.subject().to_string();

    let email = claims
        .email()
        .map(|e: &openidconnect::EndUserEmail| e.to_string());

    let name = claims
        .name()
        .and_then(|n: &openidconnect::LocalizedClaim<openidconnect::EndUserName>| n.get(None))
        .map(|n: &openidconnect::EndUserName| n.to_string());

    Ok(CallbackUserInfo {
        provider_id,
        email,
        name,
    })
}

// ── AuthenticatedUser extractor ───────────────────────────────────────────────

/// Holds the currently authenticated user. Use as an Axum handler parameter
/// to enforce authentication. Returns 401 if no valid session is found.
pub struct AuthenticatedUser(pub User);

impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
    Db: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthorized)?;

        let user_id: Option<i32> = session
            .get(SESSION_USER_ID)
            .await
            .map_err(|_| AppError::Unauthorized)?;

        let user_id = user_id.ok_or(AppError::Unauthorized)?;

        let db = Db::from_ref(state);
        let user = users::get_by_id(&db, user_id)
            .await?
            .ok_or(AppError::Unauthorized)?;

        Ok(AuthenticatedUser(user))
    }
}
