use std::{net::SocketAddr, sync::Arc};

use anyhow::Result;
use axum::{
    Router,
    routing::{get, post},
};
use lancedb::{
    Table, embeddings::sentence_transformers::SentenceTransformersEmbeddings,
};

use crate::{config::Config, embedding, search};

pub struct AppState {
    pub table: Table,
    pub embedding: Arc<SentenceTransformersEmbeddings>,
    pub fts_column: String,
    pub vector_column: String,
    pub exclude_columns: Vec<String>,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(search::health))
        .route("/search/fts", post(search::fts))
        .route("/search/vector", post(search::vector))
        .route("/search/hybrid", post(search::hybrid))
        .with_state(state)
}

pub async fn build_state(config: Config) -> Result<(Arc<AppState>, SocketAddr)> {
    let embedding = Arc::new(embedding::build(&config.embedding)?);

    let db = lancedb::connect(&config.database.path).execute().await?;
    db.embedding_registry()
        .register("embedder", embedding.clone())?;
    let table = db.open_table(&config.database.table).execute().await?;

    let exclude_columns = config
        .database
        .exclude_columns
        .unwrap_or_else(|| vec![config.database.vector_column.clone()]);
    let state = Arc::new(AppState {
        table,
        embedding,
        fts_column: config.database.fts_column,
        vector_column: config.database.vector_column,
        exclude_columns,
    });
    let addr: SocketAddr = config.server.bind.parse()?;
    Ok((state, addr))
}

pub async fn run(config: Config) -> Result<()> {
    let (state, addr) = build_state(config).await?;
    let app = router(state);
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
