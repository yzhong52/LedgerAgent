mod agent;
mod browser;
mod cli;
mod connectors;
mod credentials;
mod db;

use anyhow::Result;
use clap::Parser;
use cli::{Cli, Commands};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Sync { institution } => {
            let database = db::Database::open()?;
            let connector = connectors::get(&institution)?;
            let session = browser::Session::launch().await?;
            let creds = credentials::load(&institution)?;

            println!("[openvault] syncing {}...", institution);
            let transactions = connector.run(&session, creds).await?;
            let count = transactions.len();
            database.insert_transactions(transactions)?;
            session.close().await?;

            println!("[openvault] stored {} transactions from {}", count, institution);
        }

        Commands::List { institution, days } => {
            let database = db::Database::open()?;
            let rows = database.query_recent(institution.as_deref(), days)?;
            for tx in rows {
                println!(
                    "{}\t{:>10.2}\t{}\t{}",
                    tx.date, tx.amount, tx.account_id, tx.description
                );
            }
        }

        Commands::CredentialsSet { institution } => {
            credentials::set_interactive(&institution)?;
            println!("[openvault] credentials saved for {}", institution);
        }

        Commands::Status => {
            let database = db::Database::open()?;
            let rows = database.sync_status()?;
            if rows.is_empty() {
                println!("No syncs recorded yet.");
            }
            for row in rows {
                println!(
                    "{}\tlast sync: {}\tstatus: {}",
                    row.institution_id,
                    row.finished_at.unwrap_or_else(|| "never".to_string()),
                    row.status
                );
            }
        }
    }

    Ok(())
}
