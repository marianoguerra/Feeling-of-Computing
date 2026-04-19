use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("query too long: max {max} characters")]
    QueryTooLong { max: usize },

    #[error("query must not be empty")]
    QueryEmpty,

    #[error(transparent)]
    LanceDb(#[from] lancedb::Error),

    #[error(transparent)]
    Arrow(#[from] arrow_schema::ArrowError),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Join(#[from] tokio::task::JoinError),

    #[error("embedding error: {0}")]
    Embed(String),

    #[error("fts query error: {0}")]
    FtsQuery(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, public) = match &self {
            Self::QueryTooLong { .. } | Self::QueryEmpty => {
                (StatusCode::BAD_REQUEST, self.to_string())
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()),
        };

        if status.is_server_error() {
            tracing::error!(error = %self, source = ?std::error::Error::source(&self), "request failed");
        } else {
            tracing::info!(error = %self, "request rejected");
        }

        (status, Json(json!({ "error": public }))).into_response()
    }
}
