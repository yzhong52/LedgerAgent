use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "openvault";

pub struct Credentials {
    pub username: String,
    pub password: String,
}

pub fn load(institution: &str) -> Result<Credentials> {
    let username = Entry::new(SERVICE, &format!("{institution}:username"))
        .context("keyring error")?
        .get_password()
        .with_context(|| format!("no username found for {institution} — run `openvault credentials-set {institution}`"))?;

    let password = Entry::new(SERVICE, &format!("{institution}:password"))
        .context("keyring error")?
        .get_password()
        .with_context(|| format!("no password found for {institution} — run `openvault credentials-set {institution}`"))?;

    Ok(Credentials { username, password })
}

pub fn set_interactive(institution: &str) -> Result<()> {
    let username = prompt("Username: ")?;
    let password = rpassword::prompt_password("Password: ")?;

    Entry::new(SERVICE, &format!("{institution}:username"))?
        .set_password(&username)?;
    Entry::new(SERVICE, &format!("{institution}:password"))?
        .set_password(&password)?;

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
