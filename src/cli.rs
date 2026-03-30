use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "openvault", about = "Local financial transaction aggregator")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Sync transactions from a financial institution
    Sync {
        /// Institution ID (e.g. "td")
        institution: String,
    },

    /// List recent transactions
    List {
        /// Filter by institution ID
        #[arg(short, long)]
        institution: Option<String>,

        /// Number of days to look back (default: 30)
        #[arg(short, long, default_value = "30")]
        days: u32,
    },

    /// Save credentials for an institution to the OS keychain
    #[command(name = "credentials-set")]
    CredentialsSet {
        /// Institution ID (e.g. "td")
        institution: String,
    },

    /// Show last sync status for all institutions
    Status,
}
