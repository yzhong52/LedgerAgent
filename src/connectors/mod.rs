mod td;

use crate::browser::Session;
use crate::credentials::Credentials;
use crate::db::Transaction;
use anyhow::Result;
use async_trait::async_trait;

#[async_trait]
pub trait Connector: Send + Sync {
    fn institution_id(&self) -> &str;
    async fn run(&self, session: &Session, creds: Credentials) -> Result<Vec<Transaction>>;
}

pub fn get(institution: &str) -> Result<Box<dyn Connector>> {
    match institution {
        "td" => Ok(Box::new(td::TdConnector::new())),
        other => anyhow::bail!("unknown institution: {other}"),
    }
}
