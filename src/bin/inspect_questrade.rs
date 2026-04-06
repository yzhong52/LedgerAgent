/// Navigate to Questrade login, dump accessibility snapshots at each step,
/// and save outputs to logs/qt_*.txt.
///
/// If the session is already authenticated (browser remembered the login),
/// the login form won't be present and the script skips straight to capturing
/// the logged-in dashboard snapshot.
use anyhow::Result;
use chromiumoxide::{Browser, BrowserConfig};
use futures::StreamExt;
use openvault::browser::BrowserActions;
use rpassword;
use std::fs;
use std::io::Write;
use std::path::Path;

const LOGIN_URL: &str = "https://login.questrade.com/account/login";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("warn,chromiumoxide::handler=error")
        .init();

    let (mut browser, mut handler) = Browser::launch(
        BrowserConfig::builder()
            .with_head()
            .viewport(None)
            .args([
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-default-apps",
                "--disable-extensions",
            ])
            .build()
            .map_err(|e| anyhow::anyhow!(e))?,
    )
    .await?;

    tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            let _ = event;
        }
    });

    fs::create_dir_all("logs")?;

    let page = browser.new_page(LOGIN_URL).await?;
    let actions = BrowserActions::new(&page);

    // Give JS time to fully render the page.
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    println!("taking initial snapshot...");
    let dump = actions.dump_frames().await?;
    fs::write(Path::new("logs/qt_login.txt"), &dump)?;
    println!("saved to logs/qt_login.txt");

    let elements = actions.dump_elements().await?;
    fs::write(Path::new("logs/qt_login_elements.txt"), &elements)?;
    println!("saved to logs/qt_login_elements.txt");

    // Check if we're already logged in — login page has a "LOG IN" button.
    let already_logged_in = !dump.contains("LOG IN");

    if already_logged_in {
        println!("already logged in — skipping login flow");
    } else {
        println!("login form detected — signing in...");

        // Dismiss cookie dialog if present (id=onetrust-accept-btn-handler).
        if dump.contains("Accept all") {
            actions.click_by_xpath("//button[@id='onetrust-accept-btn-handler']").await?;
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        let username = std::env::var("OPENVAULT_QT_USERNAME")
            .unwrap_or_else(|_| {
                print!("Username: ");
                std::io::stdout().flush().ok();
                use std::io::BufRead;
                std::io::stdin().lock().lines().next().unwrap().unwrap()
            });
        let password = std::env::var("OPENVAULT_QT_PASSWORD")
            .unwrap_or_else(|_| rpassword::prompt_password("Password: ").unwrap());

        let first = password.chars().next().unwrap_or('?');
        let last = password.chars().last().unwrap_or('?');
        println!("password: {first}***{last} ({} chars)", password.len());

        // Target by id — confirmed from DOM dump.
        actions.type_by_xpath("//input[@id='userId']", &username).await?;
        actions.type_by_xpath("//input[@id='password']", &password).await?;
        actions.click_by_xpath("//button[@id='btnLogin']").await?;

        // Give the page a moment to load the MFA screen.
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        println!("taking MFA page snapshot...");
        let mfa_dump = actions.dump_frames().await?;
        fs::write(Path::new("logs/qt_mfa.txt"), &mfa_dump)?;
        println!("saved to logs/qt_mfa.txt");
        let mfa_elements = actions.dump_elements().await?;
        fs::write(Path::new("logs/qt_mfa_elements.txt"), &mfa_elements)?;
        println!("saved to logs/qt_mfa_elements.txt");

        // Check if MFA method selection is required.
        if mfa_dump.contains("verify yourself") {
            // Select SMS (pre-checked by default, but click to be explicit).
            actions.click_by_xpath("//input[@id='sms']").await?;
            actions.click_by_xpath("//button[@data-qt='sendCodeBtn']").await?;

            tokio::time::sleep(std::time::Duration::from_secs(3)).await;

            println!("taking OTP entry snapshot...");
            let otp_dump = actions.dump_frames().await?;
            fs::write(Path::new("logs/qt_otp.txt"), &otp_dump)?;
            println!("saved to logs/qt_otp.txt");
            let otp_elements = actions.dump_elements().await?;
            fs::write(Path::new("logs/qt_otp_elements.txt"), &otp_elements)?;
            println!("saved to logs/qt_otp_elements.txt");

            print!("Enter verification code: ");
            std::io::stdout().flush()?;
            let mut otp = String::new();
            std::io::stdin().read_line(&mut otp)?;
            let otp = otp.trim();

            // OTP field: input#Code (type=number). Use xpath by id.
            // type_by_xpath fires real key events which enables the VERIFY NOW button.
            actions.type_by_xpath("//input[@id='Code']", otp).await?;
            actions.click_by_xpath("//button[@id='btn-verify']").await?;

            // Questrade redirects to a new domain after OTP — give it extra time
            // to fully load before capturing the AX tree.
            tokio::time::sleep(std::time::Duration::from_secs(7)).await;
        }
    }

    // Wait for the Questrade SPA to finish rendering account data.
    tokio::time::sleep(std::time::Duration::from_secs(8)).await;

    println!("taking post-login snapshot...");
    let post_login_dump = actions.dump_frames().await?;
    fs::write(Path::new("logs/qt_post_login.txt"), &post_login_dump)?;
    println!("saved to logs/qt_post_login.txt");

    println!("press Enter to close...");
    let _ = std::io::stdin().read_line(&mut String::new());

    browser.close().await?;
    browser.wait().await?;
    Ok(())
}
