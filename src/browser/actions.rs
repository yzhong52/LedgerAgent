use anyhow::Result;
use chromiumoxide::cdp::browser_protocol::input::{DispatchKeyEventParams, DispatchKeyEventType};
use chromiumoxide::Page;

pub struct BrowserActions<'a> {
    page: &'a Page,
}

impl<'a> BrowserActions<'a> {
    pub fn new(page: &'a Page) -> Self {
        Self { page }
    }

    pub async fn navigate(&self, url: &str) -> Result<()> {
        self.page.goto(url).await?;
        self.page.wait_for_navigation().await?;
        Ok(())
    }

    pub async fn click(&self, selector: &str) -> Result<()> {
        self.page.find_element(selector).await?.click().await?;
        Ok(())
    }

    pub async fn type_text(&self, selector: &str, text: &str) -> Result<()> {
        let el = self.page.find_element(selector).await?;
        el.click().await?;
        el.type_str(text).await?;
        Ok(())
    }

    pub async fn press_key(&self, key: &str) -> Result<()> {
        self.page
            .execute(
                DispatchKeyEventParams::builder()
                    .r#type(DispatchKeyEventType::KeyDown)
                    .key(key)
                    .build()
                    .map_err(|e| anyhow::anyhow!(e))?,
            )
            .await?;
        Ok(())
    }

    /// Pause execution and wait for the user to press Enter (e.g. to complete MFA).
    pub fn wait_for_user(&self, message: &str) {
        use std::io::{self, Write};
        print!("\n[openvault] {message}\nPress Enter when ready... ");
        io::stdout().flush().ok();
        let mut buf = String::new();
        io::stdin().read_line(&mut buf).ok();
    }
}
