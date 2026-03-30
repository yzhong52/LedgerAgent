use crate::browser::Session;
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

pub struct ToolResult {
    pub output: String,
}

pub async fn execute(call: &ToolCall, session: &Session) -> Result<ToolResult> {
    let actions = session.actions();

    let output = match call.name.as_str() {
        "navigate" => {
            let url = call.input["url"].as_str().unwrap_or("");
            actions.navigate(url).await?;
            format!("navigated to {url}")
        }

        "click" => {
            let ref_id = call.input["ref"].as_str().unwrap_or("");
            // Resolve @eN ref to an accessibility node backend ID, then click via CDP.
            // For now, fall back to aria selector heuristic.
            let selector = ref_to_selector(ref_id);
            actions.click(&selector).await?;
            format!("clicked {ref_id}")
        }

        "type_text" => {
            let ref_id = call.input["ref"].as_str().unwrap_or("");
            let text = call.input["text"].as_str().unwrap_or("");
            let selector = ref_to_selector(ref_id);
            actions.type_text(&selector, text).await?;
            format!("typed into {ref_id}")
        }

        "snapshot" => {
            let snap = session.snapshot().await?;
            snap.text
        }

        "wait_for_mfa" => {
            actions.wait_for_user("MFA required. Complete verification in the browser window.");
            "MFA complete — resuming".to_string()
        }

        "done" => {
            let result = call.input["result"].as_str().unwrap_or("done").to_string();
            result
        }

        unknown => {
            anyhow::bail!("unknown tool: {unknown}")
        }
    };

    Ok(ToolResult { output })
}

/// Temporary: convert @eN ref to a positional CSS/aria selector.
/// Phase 2 will use proper AX node backend IDs from the snapshot.
fn ref_to_selector(ref_id: &str) -> String {
    // Strip the @ prefix — callers will need proper ref→node mapping once
    // we wire up AccessibilitySnapshot to return backend node IDs.
    ref_id.trim_start_matches('@').to_string()
}
