// Logging note: the default filter scopes debug output to this crate
// (`foc_server=debug` via `RUST_LOG=foc_server=debug`). Do NOT set a bare
// `RUST_LOG=debug` in production — downstream crates (lancedb, hyper,
// tower_governor) log request payloads at debug level, which includes
// user-supplied search queries.
use std::{io::IsTerminal, path::PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use foc_server::{config, embedding, server};
use tracing_subscriber::EnvFilter;

/// Default filter: info for our crate, warn for chatty deps so
/// `RUST_LOG=foc_server=debug` stays safe to set in production.
const DEFAULT_LOG_FILTER: &str =
    "info,foc_server=info,lancedb=warn,hyper=warn,tower_governor=warn,h2=warn";

#[derive(Parser, Debug)]
#[command(version, about = "FoC search server")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Start the HTTP server. Refuses to start if the embedding model is not
    /// already cached locally (run `fetch-model` first).
    Serve { config: PathBuf },
    /// Download and cache the embedding model declared in the config, then exit.
    FetchModel { config: PathBuf },
    /// Validate a config file against production best practices.
    /// Exits non-zero if any errors are found.
    Check { config: PathBuf },
}

#[tokio::main]
async fn main() -> Result<()> {
    init_logging();

    let cli = Cli::parse();
    match cli.command {
        Command::Serve { config: path } => {
            // Refuse to fetch from HuggingFace at runtime: the model must
            // have been pre-downloaded via `fetch-model`. hf-hub (used by
            // sentence-transformers) honours these env vars.
            // SAFETY: single-threaded at this point, before tokio spawns.
            unsafe {
                std::env::set_var("HF_HUB_OFFLINE", "1");
                std::env::set_var("TRANSFORMERS_OFFLINE", "1");
            }
            let cfg = config::load(&path)?;
            server::run(cfg).await.context(
                "failed to start server — if this is a model-loading error, run \
                 `foc-server fetch-model <config>` first",
            )
        }
        Command::FetchModel { config: path } => {
            let cfg = config::load(&path)?;
            embedding::build(&cfg.embedding)
                .context("fetching embedding model")?;
            tracing::info!("model '{}' cached locally", cfg.embedding.model);
            Ok(())
        }
        Command::Check { config: path } => run_check(&path),
    }
}

fn init_logging() {
    // ANSI escapes only when stdout is a terminal. Systemd captures stdout
    // into journald where escape codes become noise.
    let ansi = std::io::stdout().is_terminal();
    tracing_subscriber::fmt()
        .with_ansi(ansi)
        .with_target(true)
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER)),
        )
        .init();
}

fn run_check(path: &std::path::Path) -> Result<()> {
    let cfg = config::load(path)?;
    let report = config::check(path, &cfg);

    for w in &report.warnings {
        eprintln!("warn:  {w}");
    }
    for e in &report.errors {
        eprintln!("error: {e}");
    }

    let errors = report.errors.len();
    let warnings = report.warnings.len();
    if errors == 0 && warnings == 0 {
        println!("config {}: OK", path.display());
    } else if errors == 0 {
        println!("config {}: OK with {warnings} warning(s)", path.display());
    }

    if errors > 0 {
        anyhow::bail!("config has {errors} error(s)");
    }
    Ok(())
}
