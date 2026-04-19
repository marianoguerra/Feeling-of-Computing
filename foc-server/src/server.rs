use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::StatusCode,
    routing::{get, post},
};
use lancedb::{
    Table, embeddings::sentence_transformers::SentenceTransformersEmbeddings,
};
use tower::limit::GlobalConcurrencyLimitLayer;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};
use tower_http::timeout::TimeoutLayer;

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

pub fn router(state: Arc<AppState>, limits: &LimitsConfig) -> Result<Router> {
    let governor_conf = GovernorConfigBuilder::default()
        .per_second(limits.rate_per_second)
        .burst_size(limits.rate_burst)
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
    Ok(Router::new()
        .route("/", get(assets::index))
        .route("/assets/{*path}", get(assets::file))
        .route("/health", get(search::health))
        .merge(search_routes))
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
    .await?;
    Ok(())
}
