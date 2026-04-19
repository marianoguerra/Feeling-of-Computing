use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub embedding: EmbeddingConfig,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_bind")]
    pub bind: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { bind: default_bind() }
    }
}

fn default_bind() -> String {
    "127.0.0.1:3000".to_string()
}

#[derive(Debug, Deserialize)]
pub struct DatabaseConfig {
    pub path: String,
    pub table: String,
    pub fts_column: String,
    pub vector_column: String,
    /// Columns to strip from response bodies. Defaults to `[vector_column]`.
    #[serde(default)]
    pub exclude_columns: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct EmbeddingConfig {
    /// Model name under `sentence-transformers/`. Default: `all-MiniLM-L6-v2`.
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub ndims: Option<usize>,
    #[serde(default = "default_normalize")]
    pub normalize: bool,
    #[serde(default)]
    pub revision: Option<String>,
}

fn default_model() -> String {
    "all-MiniLM-L6-v2".to_string()
}

fn default_normalize() -> bool {
    true
}

pub fn load(path: &Path) -> Result<Config> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("reading config {}", path.display()))?;
    toml::from_str(&text).context("parsing config TOML")
}
