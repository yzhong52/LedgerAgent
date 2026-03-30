mod actions;
mod network;
mod snapshot;

pub use actions::BrowserActions;
pub use network::NetworkInterceptor;
pub use snapshot::AccessibilitySnapshot;

use anyhow::Result;
use chromiumoxide::{Browser, BrowserConfig, Page};
use futures::StreamExt;

pub struct Session {
    browser: Browser,
    pub page: Page,
}

impl Session {
    pub async fn launch() -> Result<Self> {
        let (browser, mut handler) = Browser::launch(
            BrowserConfig::builder()
                .with_head() // visible browser — needed for MFA
                .build()
                .map_err(|e| anyhow::anyhow!(e))?,
        )
        .await?;

        // Drive the browser event loop in the background
        tokio::spawn(async move {
            while let Some(event) = handler.next().await {
                if let Err(e) = event {
                    tracing::warn!("browser handler error: {e}");
                }
            }
        });

        let page = browser.new_page("about:blank").await?;
        Ok(Self { browser, page })
    }

    pub async fn close(mut self) -> Result<()> {
        self.browser.close().await?;
        Ok(())
    }

    pub fn actions(&self) -> BrowserActions<'_> {
        BrowserActions::new(&self.page)
    }

    pub fn interceptor(&self) -> NetworkInterceptor<'_> {
        NetworkInterceptor::new(&self.page)
    }

    pub async fn snapshot(&self) -> Result<AccessibilitySnapshot> {
        AccessibilitySnapshot::capture(&self.page).await
    }
}
