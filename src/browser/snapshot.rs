use crate::browser::ax::{format_ax_tree, AxSummary};
use anyhow::Result;
use chromiumoxide::cdp::browser_protocol::accessibility::{EnableParams, GetFullAxTreeParams};
use chromiumoxide::Page;

pub use crate::browser::ax::NodeInfo;

pub struct AccessibilitySnapshot {
    pub text: String,
    pub node_count: usize,
    pub refs: std::collections::HashMap<String, NodeInfo>,
}

impl AccessibilitySnapshot {
    pub fn empty() -> Self {
        Self { text: String::new(), node_count: 0, refs: std::collections::HashMap::new() }
    }

    pub async fn capture(page: &Page) -> Result<Self> {
        // Enable the accessibility domain — required before GetFullAxTree.
        // Ignore errors (may already be enabled, or page not ready yet).
        let _ = page.execute(EnableParams::default()).await;

        match page.execute(GetFullAxTreeParams::default()).await {
            Ok(result) => {
                let nodes = result.nodes.clone();
                let AxSummary { text, node_count, refs } = format_ax_tree(&nodes);
                Ok(Self { text, node_count, refs })
            }
            Err(e) => {
                // about:blank and pages mid-navigation return CDP errors like
                // "uninteresting" — return an empty snapshot so the agent can
                // still proceed (it will navigate first, then re-snapshot).
                tracing::warn!("accessibility snapshot unavailable: {e}");
                Ok(Self::empty())
            }
        }
    }
}
