use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-4-6";

pub struct ClaudeClient {
    api_key: String,
    http: Client,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: Value,
}

impl Message {
    pub fn user(text: &str) -> Self {
        Self { role: "user".into(), content: json!(text) }
    }

    pub fn assistant_tool_call(call: &super::ToolCall) -> Self {
        Self {
            role: "assistant".into(),
            content: json!([{
                "type": "tool_use",
                "id": call.id,
                "name": call.name,
                "input": call.input,
            }]),
        }
    }

    pub fn tool_result(tool_use_id: &str, output: &str) -> Self {
        Self {
            role: "user".into(),
            content: json!([{
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": output,
            }]),
        }
    }
}

pub enum Response {
    ToolCall(super::ToolCall),
    Text(String),
}

impl ClaudeClient {
    pub fn new(api_key: String) -> Self {
        Self { api_key, http: Client::new() }
    }

    pub async fn complete(&self, messages: &[Message], snapshot: &str) -> Result<Response> {
        let system = format!(
            "You are an agent controlling a web browser to extract financial transaction data.\n\
             Use the provided tools to navigate and interact with the page.\n\
             Current page accessibility snapshot:\n\n{snapshot}\n\n\
             Use element refs like @e1, @e2 to target elements. \
             When you have retrieved all transactions, call the `done` tool."
        );

        let body = json!({
            "model": MODEL,
            "max_tokens": 1024,
            "system": system,
            "tools": tools_schema(),
            "messages": messages,
        });

        let resp = self.http
            .post(API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .context("Claude API request failed")?;

        let status = resp.status();
        let json: Value = resp.json().await?;

        if !status.is_success() {
            anyhow::bail!("Claude API error {status}: {json}");
        }

        let content = json["content"]
            .as_array()
            .context("missing content array")?;

        for block in content {
            match block["type"].as_str() {
                Some("tool_use") => {
                    return Ok(Response::ToolCall(super::ToolCall {
                        id:    block["id"].as_str().unwrap_or("").to_string(),
                        name:  block["name"].as_str().unwrap_or("").to_string(),
                        input: block["input"].clone(),
                    }));
                }
                Some("text") => {
                    let text = block["text"].as_str().unwrap_or("").to_string();
                    return Ok(Response::Text(text));
                }
                _ => {}
            }
        }

        anyhow::bail!("Claude returned no usable content block")
    }
}

fn tools_schema() -> Value {
    json!([
        {
            "name": "navigate",
            "description": "Navigate the browser to a URL",
            "input_schema": {
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"]
            }
        },
        {
            "name": "click",
            "description": "Click an element by its accessibility ref (e.g. @e3)",
            "input_schema": {
                "type": "object",
                "properties": { "ref": { "type": "string" } },
                "required": ["ref"]
            }
        },
        {
            "name": "type_text",
            "description": "Type text into a focused input element",
            "input_schema": {
                "type": "object",
                "properties": {
                    "ref":  { "type": "string" },
                    "text": { "type": "string" }
                },
                "required": ["ref", "text"]
            }
        },
        {
            "name": "snapshot",
            "description": "Refresh the accessibility snapshot of the current page",
            "input_schema": { "type": "object", "properties": {} }
        },
        {
            "name": "wait_for_mfa",
            "description": "Pause and prompt the user to complete MFA in the browser window",
            "input_schema": { "type": "object", "properties": {} }
        },
        {
            "name": "done",
            "description": "Signal that the task is complete",
            "input_schema": {
                "type": "object",
                "properties": { "result": { "type": "string" } },
                "required": ["result"]
            }
        }
    ])
}
