use std::sync::Arc;

use anyhow::Result;
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

pub async fn fts(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let fts = FullTextSearchQuery::new(req.query).with_column(state.fts_column.clone())?;
    let stream = state
        .table
        .query()
        .full_text_search(fts)
        .limit(req.limit)
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
    let q_vec = embedding::embed_query(&state.embedding, &req.query)?;
    let stream = state
        .table
        .vector_search(q_vec)?
        .column(&state.vector_column)
        .distance_type(DistanceType::Cosine)
        .limit(req.limit)
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
    let q_vec = embedding::embed_query(&state.embedding, &req.query)?;
    let fts = FullTextSearchQuery::new(req.query).with_column(state.fts_column.clone())?;
    let stream = state
        .table
        .query()
        .full_text_search(fts)
        .nearest_to(q_vec)?
        .column(&state.vector_column)
        .limit(req.limit)
        .execute_hybrid(QueryExecutionOptions::default())
        .await?;
    Ok(Json(SearchResponse {
        rows: collect_rows(stream, &state.exclude_columns).await?,
    }))
}

async fn collect_rows<S>(mut stream: S, exclude: &[String]) -> Result<Vec<serde_json::Value>>
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
