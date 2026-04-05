use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "openvault";

pub struct Credentials {
    pub username: String,
    pub password: String,
}

pub fn load(institution: &str) -> Result<Credentials> {
    Ok(Credentials {
        username: "test".to_string(),
        password: "password".to_string(),
    })

    // Skip this for now until we are ready
    // // Environment variable override: OPENVAULT_TD_USERNAME / OPENVAULT_TD_PASSWORD
    // let env_prefix = format!("OPENVAULT_{}", institution.to_uppercase());
    // if let (Ok(username), Ok(password)) = (
    //     std::env::var(format!("{env_prefix}_USERNAME")),
    //     std::env::var(format!("{env_prefix}_PASSWORD")),
    // ) {
    //     return Ok(Credentials { username, password });
    // }

    // let username = Entry::new(SERVICE, &format!("{institution}:username"))
    //     .context("keyring error")?
    //     .get_password()
    //     .with_context(|| format!(
    //         "no credentials for {institution} — set OPENVAULT_{}_USERNAME / OPENVAULT_{}_PASSWORD or run `openvault credentials-set {institution}`",
    //         institution.to_uppercase(), institution.to_uppercase()
    //     ))?;

    // let password = Entry::new(SERVICE, &format!("{institution}:password"))
    //     .context("keyring error")?
    //     .get_password()
    //     .with_context(|| format!("no password found for {institution}"))?;

    // Ok(Credentials { username, password })
}

pub fn set_interactive(institution: &str) -> Result<()> {
    let username = prompt("Username: ")?;
    let password = rpassword::prompt_password("Password: ")?;

    Entry::new(SERVICE, &format!("{institution}:username"))?.set_password(&username)?;
    Entry::new(SERVICE, &format!("{institution}:password"))?.set_password(&password)?;

    Ok(())
}

fn prompt(label: &str) -> Result<String> {
    use std::io::{self, Write};
    print!("{}", label);
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique service name for tests so we never touch real credentials.
    const TEST_SERVICE: &str = "openvault-test";

    fn save(institution: &str, username: &str, password: &str) -> Result<()> {
        Entry::new(TEST_SERVICE, &format!("{institution}:username"))?.set_password(username)?;
        Entry::new(TEST_SERVICE, &format!("{institution}:password"))?.set_password(password)?;
        Ok(())
    }

    fn load_from(institution: &str) -> Result<Credentials> {
        let username =
            Entry::new(TEST_SERVICE, &format!("{institution}:username"))?.get_password()?;
        let password =
            Entry::new(TEST_SERVICE, &format!("{institution}:password"))?.get_password()?;
        Ok(Credentials { username, password })
    }

    fn delete(institution: &str) {
        let _ = Entry::new(TEST_SERVICE, &format!("{institution}:username"))
            .and_then(|e| Ok(e.delete_credential()?));
        let _ = Entry::new(TEST_SERVICE, &format!("{institution}:password"))
            .and_then(|e| Ok(e.delete_credential()?));
    }

    #[test]
    fn round_trip_stores_and_retrieves() {
        let inst = "test-bank-round-trip";
        delete(inst);

        save(inst, "alice", "s3cr3t").expect("save failed");
        let creds = load_from(inst).expect("load failed");

        assert_eq!(creds.username, "alice");
        assert_eq!(creds.password, "s3cr3t");

        delete(inst);
    }

    #[test]
    fn missing_entry_returns_error() {
        let inst = "test-bank-missing";
        delete(inst); // ensure clean state

        let result = load_from(inst);
        assert!(result.is_err(), "expected error for missing credential");
    }

    #[test]
    fn overwrite_updates_value() {
        let inst = "test-bank-overwrite";
        delete(inst);

        save(inst, "alice", "first").expect("first save failed");
        save(inst, "alice", "second").expect("second save failed");

        let creds = load_from(inst).expect("load after overwrite failed");
        assert_eq!(creds.password, "second");

        delete(inst);
    }

    #[test]
    fn special_characters_preserved() {
        let inst = "test-bank-special";
        delete(inst);

        let pw = "p@$$w0rd!#%^&*()_+-=[]{}|;':\",./<>?";
        save(inst, "user@example.com", pw).expect("save failed");
        let creds = load_from(inst).expect("load failed");

        assert_eq!(creds.username, "user@example.com");
        assert_eq!(creds.password, pw);

        delete(inst);
    }

    #[test]
    fn delete_removes_entry() {
        let inst = "test-bank-delete";
        delete(inst);

        save(inst, "bob", "pass").expect("save failed");
        delete(inst);

        let result = load_from(inst);
        assert!(result.is_err(), "expected error after deletion");
    }
}
