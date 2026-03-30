use anyhow::Result;
use chromiumoxide::cdp::browser_protocol::network::{
    EnableParams, EventResponseReceived,
};
use chromiumoxide::Page;
use futures::StreamExt;
use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;

/// Listens to network responses and captures JSON bodies that match a filter.
pub struct NetworkInterceptor<'a> {
    page: &'a Page,
}

impl<'a> NetworkInterceptor<'a> {
    pub fn new(page: &'a Page) -> Self {
        Self { page }
    }

    /// Start collecting response URLs that contain `url_fragment`.
    /// Returns a handle to the background task and a shared list of captured URLs.
    pub async fn start_capturing(
        &self,
        url_fragment: &'static str,
    ) -> Result<(JoinHandle<()>, Arc<Mutex<Vec<String>>>)> {
        self.page.execute(EnableParams::default()).await?;

        let captured: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_clone = captured.clone();

        let mut events = self.page.event_listener::<EventResponseReceived>().await?;

        let handle = tokio::spawn(async move {
            while let Some(event) = events.next().await {
                let url = event.response.url.clone();
                if url.contains(url_fragment) {
                    tracing::debug!("intercepted response: {url}");
                    captured_clone.lock().unwrap().push(url);
                }
            }
        });

        Ok((handle, captured))
    }
}
