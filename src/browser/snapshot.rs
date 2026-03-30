use anyhow::Result;
use chromiumoxide::cdp::browser_protocol::accessibility::{
    AxNode, GetFullAxTreeParams,
};
use chromiumoxide::Page;

/// A compact accessibility snapshot of the current page, formatted for LLM consumption.
pub struct AccessibilitySnapshot {
    pub text: String,
    pub node_count: usize,
}

impl AccessibilitySnapshot {
    pub async fn capture(page: &Page) -> Result<Self> {
        let result = page
            .execute(GetFullAxTreeParams::default())
            .await?;

        let nodes = result.nodes.clone();
        let node_count = nodes.len();
        let text = format_tree(&nodes);

        Ok(Self { text, node_count })
    }
}

/// Format the AX tree into a compact text representation.
/// Only includes nodes that are visible and have a meaningful role.
fn format_tree(nodes: &[AxNode]) -> String {
    let mut lines = Vec::new();
    let mut ref_counter = 1usize;

    for node in nodes {
        let role = match &node.role {
            Some(r) => r.value.as_ref().and_then(|v| v.as_str()).unwrap_or(""),
            None => continue,
        };

        // Skip non-interactive, non-content roles
        if matches!(
            role,
            "none" | "presentation" | "generic" | "group" | "InlineTextBox"
        ) {
            continue;
        }

        let name = node
            .name
            .as_ref()
            .and_then(|n| n.value.as_ref().and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();

        if name.is_empty() && !is_interactive(role) {
            continue;
        }

        let ref_id = format!("@e{}", ref_counter);
        ref_counter += 1;

        if name.is_empty() {
            lines.push(format!("[{role} {ref_id}]"));
        } else {
            lines.push(format!("[{role} {ref_id}] \"{name}\""));
        }
    }

    lines.join("\n")
}

fn is_interactive(role: &str) -> bool {
    matches!(
        role,
        "button"
            | "link"
            | "textbox"
            | "checkbox"
            | "radio"
            | "combobox"
            | "listbox"
            | "menuitem"
            | "option"
            | "tab"
            | "searchbox"
            | "spinbutton"
            | "switch"
    )
}
