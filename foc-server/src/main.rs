// Logging note: `RUST_LOG` defaults to `info`. Do not run production with
// `RUST_LOG=debug` — downstream crates (lancedb, hyper, tower_governor) log
// request payloads at debug level, which includes user-supplied search queries.
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use foc_server::{config, embedding, server};
use tracing_subscriber::EnvFilter;

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
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

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
    }
}
