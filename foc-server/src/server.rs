use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{Request, StatusCode},
    routing::{get, post},
};
use lancedb::{
    Table, embeddings::sentence_transformers::SentenceTransformersEmbeddings,
};
use tower::limit::GlobalConcurrencyLimitLayer;
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder,
    key_extractor::SmartIpKeyExtractor,
};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
    trace::{DefaultOnResponse, TraceLayer},
};
use tracing::Level;

use crate::{
    assets,
    config::{Config, LimitsConfig},
    embedding, search,
};

pub struct AppState {
    pub table: Table,
    pub embedding: Arc<SentenceTransformersEmbeddings>,
    pub fts_column: String,
    pub vector_column: String,
    pub exclude_columns: Vec<String>,
}

const MAX_BODY_BYTES: usize = 4 * 1024;
const REQUEST_ID_HEADER: &str = "x-request-id";

pub fn router(state: Arc<AppState>, limits: &LimitsConfig) -> Result<Router> {
    // SmartIpKeyExtractor honours Forwarded / X-Forwarded-For / X-Real-IP and
    // falls back to the connection peer IP. Only safe because we bind on
    // loopback — an internet-facing bind would let clients spoof XFF.
    let governor_conf = GovernorConfigBuilder::default()
        .per_second(limits.rate_per_second)
        .burst_size(limits.rate_burst)
        .key_extractor(SmartIpKeyExtractor)
        .finish()
        .context("building rate-limiter config")?;

    let search_routes = Router::new()
        .route("/search/fts", post(search::fts))
        .route("/search/vector", post(search::vector))
        .route("/search/hybrid", post(search::hybrid))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(limits.timeout_secs),
        ))
        .layer(GlobalConcurrencyLimitLayer::new(limits.concurrency))
        .layer(GovernorLayer::new(governor_conf))
        .with_state(state);

    // `/health` stays outside the rate/concurrency limits so nginx health
    // checks keep succeeding even while search handlers are saturated.
    let app = Router::new()
        .route("/", get(assets::index))
        .route("/assets/{*path}", get(assets::file))
        .route("/health", get(search::health))
        .merge(search_routes);

    // Request-id + access log wrapping. Layer order note: axum applies the
    // last `.layer()` as the outermost, so the request flows
    // SetRequestId → TraceLayer → handlers, and the response flows back out
    // through PropagateRequestId which copies the id into the response
    // headers for clients to report in bug reports.
    let trace = TraceLayer::new_for_http()
        .make_span_with(|req: &Request<_>| {
            let rid = req
                .headers()
                .get(REQUEST_ID_HEADER)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            tracing::info_span!(
                "http",
                method = %req.method(),
                path = %req.uri().path(),
                request_id = %rid,
            )
        })
        .on_response(DefaultOnResponse::new().level(Level::INFO));

    Ok(app
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(trace)
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid)))
}

pub async fn build_state(config: &Config) -> Result<(Arc<AppState>, SocketAddr)> {
    let embedding = Arc::new(embedding::build(&config.embedding)?);

    let db = lancedb::connect(&config.database.path).execute().await?;
    db.embedding_registry()
        .register("embedder", embedding.clone())?;
    let table = db.open_table(&config.database.table).execute().await?;

    let exclude_columns = config
        .database
        .exclude_columns
        .clone()
        .unwrap_or_else(|| vec![config.database.vector_column.clone()]);
    let state = Arc::new(AppState {
        table,
        embedding,
        fts_column: config.database.fts_column.clone(),
        vector_column: config.database.vector_column.clone(),
        exclude_columns,
    });
    let addr: SocketAddr = config.server.bind.parse()?;
    Ok((state, addr))
}

pub async fn run(config: Config) -> Result<()> {
    let (state, addr) = build_state(&config).await?;
    let app = router(state, &config.server.limits)?;
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    tracing::info!("server shut down cleanly");
    Ok(())
}

/// Completes when the process receives SIGINT (Ctrl-C) or SIGTERM
/// (systemd stop). Triggers axum's graceful shutdown path which stops
/// accepting new connections and waits for in-flight requests — capped
/// by systemd's `TimeoutStopSec`.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::warn!(%err, "failed to install Ctrl-C handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(err) => {
                tracing::warn!(%err, "failed to install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("SIGINT received, shutting down"),
        _ = terminate => tracing::info!("SIGTERM received, shutting down"),
    }
}
