use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use foc_server::{config, server};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(version, about = "FoC search server")]
struct Cli {
    /// Path to TOML configuration file.
    config: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();
    let cfg = config::load(&cli.config)?;
    server::run(cfg).await
}
