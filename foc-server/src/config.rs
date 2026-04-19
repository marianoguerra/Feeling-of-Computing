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
    #[serde(default)]
    pub limits: LimitsConfig,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: default_bind(),
            limits: LimitsConfig::default(),
        }
    }
}

fn default_bind() -> String {
    "127.0.0.1:3000".to_string()
}

#[derive(Debug, Deserialize)]
pub struct LimitsConfig {
    #[serde(default = "default_rate_per_second")]
    pub rate_per_second: u64,
    #[serde(default = "default_rate_burst")]
    pub rate_burst: u32,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

impl Default for LimitsConfig {
    fn default() -> Self {
        Self {
            rate_per_second: default_rate_per_second(),
            rate_burst: default_rate_burst(),
            concurrency: default_concurrency(),
            timeout_secs: default_timeout_secs(),
        }
    }
}

fn default_rate_per_second() -> u64 {
    5
}
fn default_rate_burst() -> u32 {
    10
}
fn default_concurrency() -> usize {
    32
}
fn default_timeout_secs() -> u64 {
    30
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

#[derive(Debug, Default)]
pub struct CheckReport {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Lint a loaded config for production bad practices. Returns a report
/// of errors (things that will break or leak) and warnings (things that
/// are probably wrong but might be intentional).
pub fn check(path: &Path, cfg: &Config) -> CheckReport {
    let mut r = CheckReport::default();

    check_database(cfg, &mut r);
    check_bind(cfg, &mut r);
    check_limits(cfg, &mut r);
    check_file_perms(path, &mut r);

    r
}

fn check_database(cfg: &Config, r: &mut CheckReport) {
    if !Path::new(&cfg.database.path).is_absolute() {
        r.errors.push(format!(
            "database.path is relative ({:?}); use an absolute path so the service is \
             independent of systemd's WorkingDirectory",
            cfg.database.path
        ));
    }

    let vec_col = &cfg.database.vector_column;
    match &cfg.database.exclude_columns {
        None => r.warnings.push(
            "database.exclude_columns is unset; default is [vector_column]. \
             Set it explicitly to avoid leaking new binary columns added later."
                .to_string(),
        ),
        Some(cols) if !cols.iter().any(|c| c == vec_col) => r.errors.push(format!(
            "database.exclude_columns does not contain vector_column {vec_col:?}; \
             responses will include raw embedding vectors"
        )),
        _ => {}
    }
}

fn check_bind(cfg: &Config, r: &mut CheckReport) {
    let bind = cfg.server.bind.as_str();
    let host = bind.rsplit_once(':').map(|(h, _)| h).unwrap_or(bind);
    let host = host.trim_start_matches('[').trim_end_matches(']');

    if host == "0.0.0.0" || host == "::" {
        r.errors.push(format!(
            "server.bind {bind:?} exposes the service on every interface, \
             bypassing the reverse proxy. Bind to 127.0.0.1 instead."
        ));
    } else if host != "127.0.0.1" && host != "::1" && host != "localhost" {
        r.warnings.push(format!(
            "server.bind host {host:?} is not a loopback address; only do this \
             if the reverse proxy lives on another host and the network is trusted"
        ));
    }
}

fn check_limits(cfg: &Config, r: &mut CheckReport) {
    let l = &cfg.server.limits;
    if l.rate_per_second == 0 {
        r.errors
            .push("server.limits.rate_per_second = 0 rejects every request".to_string());
    }
    if l.timeout_secs == 0 {
        r.errors
            .push("server.limits.timeout_secs = 0 causes every request to time out".to_string());
    }
    if l.concurrency == 0 {
        r.errors
            .push("server.limits.concurrency = 0 prevents any request from running".to_string());
    }
    if l.rate_burst < l.rate_per_second as u32 {
        r.warnings.push(format!(
            "server.limits.rate_burst ({}) is below rate_per_second ({}); \
             clients will hit 429 even at the sustained rate",
            l.rate_burst, l.rate_per_second
        ));
    }
}

#[cfg(unix)]
fn check_file_perms(path: &Path, r: &mut CheckReport) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    let mode = meta.permissions().mode() & 0o777;
    if mode & 0o004 != 0 {
        r.warnings.push(format!(
            "config {} is world-readable (mode {mode:o}); recommended 0640 root:<service-group>",
            path.display()
        ));
    }
}

#[cfg(not(unix))]
fn check_file_perms(_path: &Path, _r: &mut CheckReport) {}
