mod claude;
mod tools;

pub use claude::ClaudeClient;
pub use tools::ToolCall;

use crate::browser::Session;
use anyhow::Result;

/// The agentic observe → reason → act loop.
/// Drives the browser via Claude tool calls until the task is complete.
pub struct Agent {
    client: ClaudeClient,
    max_steps: usize,
}

impl Agent {
    pub fn new(api_key: String) -> Self {
        Self {
            client: ClaudeClient::new(api_key),
            max_steps: 30,
        }
    }

    pub async fn run(&self, task: &str, session: &Session) -> Result<String> {
        let mut messages = vec![claude::Message::user(task)];

        for step in 0..self.max_steps {
            tracing::debug!("agent step {step}");

            let snapshot = session.snapshot().await?;
            tracing::debug!("snapshot ({} nodes):\n{}", snapshot.node_count, snapshot.text);

            let response = self.client.complete(&messages, &snapshot.text).await?;

            match response {
                claude::Response::ToolCall(call) => {
                    let result = tools::execute(&call, session).await?;
                    messages.push(claude::Message::assistant_tool_call(&call));
                    messages.push(claude::Message::tool_result(&call.id, &result.output));

                    if call.name == "done" {
                        return Ok(result.output);
                    }
                }
                claude::Response::Text(text) => {
                    return Ok(text);
                }
            }
        }

        anyhow::bail!("agent reached max steps ({}) without completing", self.max_steps)
    }
}
