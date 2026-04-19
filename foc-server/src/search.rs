use std::sync::Arc;

use arrow_array::RecordBatch;
use axum::{Json, extract::State};
use futures::TryStreamExt;
use lance_index::scalar::FullTextSearchQuery;
use lancedb::{
    DistanceType,
    query::{ExecutableQuery, QueryBase, QueryExecutionOptions},
};
use serde::{Deserialize, Serialize};

use crate::{embedding, error::ApiError, server::AppState};

const MAX_QUERY_CHARS: usize = 100;
const MAX_LIMIT: usize = 100;

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    10
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub rows: Vec<serde_json::Value>,
}

pub async fn health() -> &'static str {
    "ok"
}

fn validate(req: &SearchRequest) -> Result<(String, usize), ApiError> {
    let q = req.query.trim();
    if q.is_empty() {
        return Err(ApiError::QueryEmpty);
    }
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err(ApiError::QueryTooLong { max: MAX_QUERY_CHARS });
    }
    let limit = req.limit.clamp(1, MAX_LIMIT);
    Ok((q.to_string(), limit))
}

pub async fn fts(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let (query, limit) = validate(&req)?;
    let fts = FullTextSearchQuery::new(query)
        .with_column(state.fts_column.clone())
        .map_err(|e| ApiError::FtsQuery(e.to_string()))?;
    let stream = state
        .table
        .query()
        .full_text_search(fts)
        .limit(limit)
        .execute()
        .await?;
    Ok(Json(SearchResponse {
        rows: collect_rows(stream, &state.exclude_columns).await?,
    }))
}

pub async fn vector(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let (query, limit) = validate(&req)?;
    let q_vec = {
        let embedding = state.embedding.clone();
        tokio::task::spawn_blocking(move || embedding::embed_query(&embedding, &query))
            .await?
            .map_err(|e| ApiError::Embed(e.to_string()))?
    };
    let stream = state
        .table
        .vector_search(q_vec)?
        .column(&state.vector_column)
        .distance_type(DistanceType::Cosine)
        .limit(limit)
        .execute()
        .await?;
    Ok(Json(SearchResponse {
        rows: collect_rows(stream, &state.exclude_columns).await?,
    }))
}

pub async fn hybrid(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let (query, limit) = validate(&req)?;
    // Invariant: hybrid search sends the same user query string to both the
    // FTS parser and the embedder. If you refactor, keep them identical —
    // divergence silently skews the fused ranking.
    let q_vec = {
        let embedding = state.embedding.clone();
        let q = query.clone();
        tokio::task::spawn_blocking(move || embedding::embed_query(&embedding, &q))
            .await?
            .map_err(|e| ApiError::Embed(e.to_string()))?
    };
    let fts = FullTextSearchQuery::new(query)
        .with_column(state.fts_column.clone())
        .map_err(|e| ApiError::FtsQuery(e.to_string()))?;
    let stream = state
        .table
        .query()
        .full_text_search(fts)
        .nearest_to(q_vec)?
        .column(&state.vector_column)
        .limit(limit)
        .execute_hybrid(QueryExecutionOptions::default())
        .await?;
    Ok(Json(SearchResponse {
        rows: collect_rows(stream, &state.exclude_columns).await?,
    }))
}

async fn collect_rows<S>(mut stream: S, exclude: &[String]) -> Result<Vec<serde_json::Value>, ApiError>
where
    S: futures::Stream<Item = lancedb::Result<RecordBatch>> + Unpin,
{
    let mut out = Vec::new();
    while let Some(batch) = stream.try_next().await? {
        let mut buf = Vec::new();
        let mut writer = arrow_json::ArrayWriter::new(&mut buf);
        writer.write(&batch)?;
        writer.finish()?;
        let value: serde_json::Value = serde_json::from_slice(&buf)?;
        if let serde_json::Value::Array(rows) = value {
            for mut row in rows {
                if let serde_json::Value::Object(map) = &mut row {
                    for key in exclude {
                        map.remove(key);
                    }
                }
                out.push(row);
            }
        }
    }
    Ok(out)
}
