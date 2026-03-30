use anyhow::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

pub struct Database {
    conn: Connection,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub institution_id: String,
    pub account_id: String,
    pub date: String,
    pub amount: f64,
    pub currency: String,
    pub description: String,
    pub raw_description: Option<String>,
    pub category: Option<String>,
    pub synced_at: String,
}

#[derive(Debug)]
pub struct SyncStatus {
    pub institution_id: String,
    pub finished_at: Option<String>,
    pub status: String,
}

impl Database {
    pub fn open() -> Result<Self> {
        let path = dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("openvault")
            .join("transactions.db");

        std::fs::create_dir_all(path.parent().unwrap())?;
        let conn = Connection::open(&path)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch("
            CREATE TABLE IF NOT EXISTS transactions (
                id              TEXT PRIMARY KEY,
                institution_id  TEXT NOT NULL,
                account_id      TEXT NOT NULL,
                date            TEXT NOT NULL,
                amount          REAL NOT NULL,
                currency        TEXT NOT NULL DEFAULT 'CAD',
                description     TEXT NOT NULL,
                raw_description TEXT,
                category        TEXT,
                synced_at       TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                institution_id  TEXT NOT NULL,
                started_at      TEXT NOT NULL,
                finished_at     TEXT,
                status          TEXT NOT NULL,
                error           TEXT
            );
        ")?;
        Ok(())
    }

    pub fn insert_transactions(&self, transactions: Vec<Transaction>) -> Result<()> {
        let mut stmt = self.conn.prepare("
            INSERT OR REPLACE INTO transactions
                (id, institution_id, account_id, date, amount, currency,
                 description, raw_description, category, synced_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ")?;

        for tx in transactions {
            stmt.execute(params![
                tx.id, tx.institution_id, tx.account_id, tx.date,
                tx.amount, tx.currency, tx.description,
                tx.raw_description, tx.category, tx.synced_at
            ])?;
        }
        Ok(())
    }

    pub fn query_recent(&self, institution: Option<&str>, days: u32) -> Result<Vec<Transaction>> {
        let cutoff = format!("-{} days", days);
        let sql = match institution {
            Some(_) => "SELECT * FROM transactions WHERE institution_id = ?1 AND date >= date('now', ?2) ORDER BY date DESC",
            None    => "SELECT * FROM transactions WHERE date >= date('now', ?2) ORDER BY date DESC",
        };

        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(
            params![institution.unwrap_or(""), cutoff],
            |row| Ok(Transaction {
                id:              row.get(0)?,
                institution_id:  row.get(1)?,
                account_id:      row.get(2)?,
                date:            row.get(3)?,
                amount:          row.get(4)?,
                currency:        row.get(5)?,
                description:     row.get(6)?,
                raw_description: row.get(7)?,
                category:        row.get(8)?,
                synced_at:       row.get(9)?,
            }),
        )?;

        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    pub fn sync_status(&self) -> Result<Vec<SyncStatus>> {
        let mut stmt = self.conn.prepare("
            SELECT institution_id, finished_at, status
            FROM sync_log
            WHERE id IN (
                SELECT MAX(id) FROM sync_log GROUP BY institution_id
            )
            ORDER BY institution_id
        ")?;

        let rows = stmt.query_map([], |row| Ok(SyncStatus {
            institution_id: row.get(0)?,
            finished_at:    row.get(1)?,
            status:         row.get(2)?,
        }))?;

        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    pub fn log_sync_start(&self, institution_id: &str) -> Result<i64> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO sync_log (institution_id, started_at, status) VALUES (?1, ?2, 'running')",
            params![institution_id, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn log_sync_finish(&self, log_id: i64, status: &str, error: Option<&str>) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE sync_log SET finished_at = ?1, status = ?2, error = ?3 WHERE id = ?4",
            params![now, status, error, log_id],
        )?;
        Ok(())
    }
}
