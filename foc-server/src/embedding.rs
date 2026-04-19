use std::{iter::once, sync::Arc};

use anyhow::Result;
use arrow_array::{Array, StringArray};
use lancedb::embeddings::{
    EmbeddingFunction, sentence_transformers::SentenceTransformersEmbeddings,
};

use crate::config::EmbeddingConfig;

pub fn build(cfg: &EmbeddingConfig) -> Result<SentenceTransformersEmbeddings> {
    let mut b = SentenceTransformersEmbeddings::builder()
        .model(&cfg.model)
        .normalize(cfg.normalize);
    if let Some(n) = cfg.ndims {
        b = b.ndims(n);
    }
    if let Some(rev) = &cfg.revision {
        b = b.revision(rev);
    }
    Ok(b.build()?)
}

pub fn embed_query(
    embedding: &SentenceTransformersEmbeddings,
    query: &str,
) -> Result<Arc<dyn Array>> {
    let arr = Arc::new(StringArray::from_iter_values(once(query))) as Arc<dyn Array>;
    Ok(embedding.compute_query_embeddings(arr)?)
}
