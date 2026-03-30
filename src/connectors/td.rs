use super::Connector;
use crate::agent::Agent;
use crate::browser::Session;
use crate::credentials::Credentials;
use crate::db::Transaction;
use anyhow::Result;
use async_trait::async_trait;
use std::env;

const INSTITUTION_ID: &str = "td";
const EASYWEB_URL: &str = "https://easyweb.td.com";

pub struct TdConnector;

impl TdConnector {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Connector for TdConnector {
    fn institution_id(&self) -> &str {
        INSTITUTION_ID
    }

    async fn run(&self, session: &Session, creds: Credentials) -> Result<Vec<Transaction>> {
        let api_key = env::var("ANTHROPIC_API_KEY")
            .map_err(|_| anyhow::anyhow!("ANTHROPIC_API_KEY not set"))?;

        let agent = Agent::new(api_key);

        let task = format!(
            "Go to {EASYWEB_URL} and log in with username '{}' and password '{}'. \
             Once logged in, navigate to the transaction history for all accounts \
             and retrieve all transactions from the last 90 days. \
             Return the transactions as a JSON array with fields: \
             date (YYYY-MM-DD), amount (negative for debits), description, account_id.",
            creds.username, creds.password
        );

        // Start network interception before navigation — TD's SPA fires XHR
        // responses with transaction JSON when the accounts page loads.
        let interceptor = session.interceptor();
        let (_handle, captured_urls) = interceptor.start_capturing("transaction").await?;

        let raw_result = agent.run(&task, session).await?;

        // Check if any transaction API responses were intercepted
        let intercepted = captured_urls.lock().unwrap().clone();
        if !intercepted.is_empty() {
            tracing::info!("intercepted {} transaction API responses", intercepted.len());
        }

        // Parse the agent's returned JSON into canonical transactions
        parse_transactions(&raw_result)
    }
}

fn parse_transactions(raw: &str) -> Result<Vec<Transaction>> {
    // Extract JSON array from agent output (may be wrapped in text)
    let start = raw.find('[').unwrap_or(0);
    let end = raw.rfind(']').map(|i| i + 1).unwrap_or(raw.len());
    let json_str = &raw[start..end];

    let items: Vec<serde_json::Value> = serde_json::from_str(json_str)
        .map_err(|e| anyhow::anyhow!("failed to parse transaction JSON: {e}\nraw: {raw}"))?;

    let now = chrono::Utc::now().to_rfc3339();

    let transactions = items
        .iter()
        .filter_map(|item| {
            let date = item["date"].as_str()?.to_string();
            let amount = item["amount"].as_f64()?;
            let description = item["description"].as_str()?.to_string();
            let account_id = item["account_id"].as_str().unwrap_or("unknown").to_string();

            let id = format!(
                "{INSTITUTION_ID}:{account_id}:{date}:{amount}:{}",
                &description[..description.len().min(20)]
            );

            Some(Transaction {
                id,
                institution_id: INSTITUTION_ID.to_string(),
                account_id,
                date,
                amount,
                currency: "CAD".to_string(),
                description: description.clone(),
                raw_description: Some(description),
                category: None,
                synced_at: now.clone(),
            })
        })
        .collect();

    Ok(transactions)
}
