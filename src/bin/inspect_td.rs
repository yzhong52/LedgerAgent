/// Navigate to TD EasyWeb, dump all readable elements across every frame,
/// and save the output to logs/td_landing_page.txt.
use anyhow::Result;
use chromiumoxide::{Browser, BrowserConfig};
use futures::StreamExt;
use openvault::browser::BrowserActions;
use std::fs;
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("warn")
        .init();

    let (browser, mut handler) = Browser::launch(
        BrowserConfig::builder()
            .with_head()
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

    let page = browser.new_page("about:blank").await?;
    let actions = BrowserActions::new(&page);

    println!("navigating to https://easyweb.td.com ...");
    actions.navigate("https://easyweb.td.com").await?;

    // Give JS time to fully render the page and iframes
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    println!("dumping frames...");
    let dump = actions.dump_frames().await?;

    let out_path = Path::new("logs/td_landing_page.txt");
    fs::create_dir_all(out_path.parent().unwrap())?;
    fs::write(out_path, &dump)?;

    println!("saved to {}", out_path.display());
    Ok(())
}
