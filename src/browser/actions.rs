use anyhow::{Context, Result};
use chromiumoxide::cdp::js_protocol::runtime::EvaluateParams;
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

    /// Click an element by ARIA role and accessible name.
    /// Tries the main document first, then falls back to each iframe.
    pub async fn click_by_role_name(&self, role: &str, name: &str) -> Result<()> {
        // Main document — XPath candidates
        for xpath in xpath_candidates(role, name) {
            if let Ok(el) = self.page.find_xpath(&xpath).await {
                tracing::debug!("click [{role}] \"{name}\" via main-doc xpath");
                el.click().await?;
                return Ok(());
            }
        }
        // Main document — CSS candidates
        for css in css_candidates(role, name) {
            if let Ok(el) = self.page.find_element(&css).await {
                tracing::debug!("click [{role}] \"{name}\" via main-doc css");
                el.click().await?;
                return Ok(());
            }
        }
        // Iframes — JS eval in each frame's execution context
        self.exec_in_frames(role, name, "el.click()").await
            .with_context(|| format!("could not find [{role}] \"{name}\" in main doc or any iframe"))
    }

    /// Type text into an element by ARIA role and accessible name.
    pub async fn type_by_role_name(&self, role: &str, name: &str, text: &str) -> Result<()> {
        // Main document
        for xpath in xpath_candidates(role, name) {
            if let Ok(el) = self.page.find_xpath(&xpath).await {
                tracing::debug!("type [{role}] \"{name}\" via main-doc xpath");
                el.click().await?;
                el.type_str(text).await?;
                return Ok(());
            }
        }
        for css in css_candidates(role, name) {
            if let Ok(el) = self.page.find_element(&css).await {
                tracing::debug!("type [{role}] \"{name}\" via main-doc css");
                el.click().await?;
                el.type_str(text).await?;
                return Ok(());
            }
        }
        // Iframes — focus + set value + dispatch input/change events in frame context.
        // Dispatching synthetic events is necessary for React/Angular to pick up the value.
        let escaped = text.replace('\\', "\\\\").replace('\'', "\\'");
        let js = format!(
            "el.focus(); \
             el.value = '{escaped}'; \
             el.dispatchEvent(new Event('input', {{bubbles:true}})); \
             el.dispatchEvent(new Event('change', {{bubbles:true}}));"
        );
        self.exec_in_frames(role, name, &js).await
            .with_context(|| format!("could not find [{role}] \"{name}\" in main doc or any iframe"))
    }

    /// Dump all inputs, textareas, and buttons across every frame.
    /// Returns a JSON-like string showing tag + all attributes for each element.
    /// Used to diagnose why click/type_text can't find an element.
    pub async fn dump_frames(&self) -> Result<String> {
        let js = r#"
            (function() {
                var els = document.querySelectorAll('input, textarea, button, a, [role]');
                return Array.from(els).map(function(el) {
                    var attrs = {};
                    for (var i = 0; i < el.attributes.length; i++) {
                        attrs[el.attributes[i].name] = el.attributes[i].value;
                    }
                    return JSON.stringify({ tag: el.tagName.toLowerCase(), attrs: attrs, text: (el.innerText || '').trim().slice(0, 80) });
                }).join('\n');
            })()
        "#;

        let frames = self.page.frames().await?;
        let mut out = Vec::new();

        // Main frame
        match self.page.evaluate_expression(js).await {
            Ok(r) => {
                if let Some(v) = r.value() {
                    out.push(format!("=== main frame ===\n{}", v.as_str().unwrap_or("")));
                }
            }
            Err(e) => out.push(format!("=== main frame error: {e} ===")),
        }

        // Iframes
        for (i, frame_id) in frames.iter().enumerate() {
            if let Ok(Some(ctx)) = self.page.frame_execution_context(frame_id.clone()).await {
                let params = EvaluateParams::builder()
                    .expression(js)
                    .context_id(ctx)
                    .build()
                    .map_err(|e| anyhow::anyhow!(e))?;
                match self.page.evaluate_expression(params).await {
                    Ok(r) => {
                        if let Some(v) = r.value() {
                            let s = v.as_str().unwrap_or("").trim().to_string();
                            if !s.is_empty() {
                                out.push(format!("=== frame {i} ===\n{s}"));
                            }
                        }
                    }
                    Err(e) => out.push(format!("=== frame {i} error: {e} ===")),
                }
            }
        }

        Ok(out.join("\n\n"))
    }

    /// Pause and wait for the user to press Enter in the terminal (e.g. after MFA).
    pub fn wait_for_user(&self, message: &str) {
        use std::io::{self, Write};
        print!("\n[openvault] {message}\nPress Enter when ready... ");
        io::stdout().flush().ok();
        let mut buf = String::new();
        io::stdin().read_line(&mut buf).ok();
    }

    // ── private ──────────────────────────────────────────────────────────────

    /// Iterate over all frames in the page, find the element by CSS selector in
    /// each frame's execution context, and run `js_action` on it.
    async fn exec_in_frames(&self, role: &str, name: &str, js_action: &str) -> Result<()> {
        let frames = self.page.frames().await?;
        tracing::debug!("searching {} frames for [{role}] \"{name}\"", frames.len());

        for frame_id in frames {
            let ctx_id = match self.page.frame_execution_context(frame_id.clone()).await {
                Ok(Some(id)) => id,
                _ => continue,
            };

            for css in css_candidates(role, name) {
                let js = format!(
                    "(function() {{ \
                        var el = document.querySelector({css:?}); \
                        if (!el) return false; \
                        {js_action}; \
                        return true; \
                    }})()"
                );

                let params = EvaluateParams::builder()
                    .expression(js)
                    .context_id(ctx_id.clone())
                    .build()
                    .map_err(|e| anyhow::anyhow!(e))?;

                match self.page.evaluate_expression(params).await {
                    Ok(result) => {
                        let found = result
                            .value()
                            .and_then(|v: &serde_json::Value| v.as_bool())
                            .unwrap_or(false);
                        if found {
                            tracing::debug!(
                                "exec_in_frames [{role}] \"{name}\" via css={css:?} in frame"
                            );
                            return Ok(());
                        }
                    }
                    Err(e) => {
                        tracing::debug!("frame eval error for [{role}] \"{name}\": {e}");
                    }
                }
            }
        }

        anyhow::bail!("not found in any frame")
    }
}

/// CSS selectors ranked by specificity for a given role+name.
fn css_candidates(role: &str, name: &str) -> Vec<String> {
    if name.is_empty() {
        return vec![format!("[role='{role}']")];
    }

    // CSS attribute selectors don't need XPath-style escaping
    let n = name.replace('"', "\\\"");

    match role {
        "button" | "menuitem" => vec![
            format!("button[aria-label=\"{n}\"]"),
            format!("input[type='submit'][value=\"{n}\"]"),
            format!("input[type='button'][value=\"{n}\"]"),
            format!("[role='button'][aria-label=\"{n}\"]"),
        ],
        "link" => vec![
            format!("a[aria-label=\"{n}\"]"),
            format!("[role='link'][aria-label=\"{n}\"]"),
        ],
        "textbox" | "searchbox" => vec![
            format!("input[placeholder=\"{n}\"]"),
            format!("input[aria-label=\"{n}\"]"),
            format!("input[name=\"{n}\"]"),
            format!("textarea[placeholder=\"{n}\"]"),
            format!("textarea[aria-label=\"{n}\"]"),
            format!("[role='textbox'][aria-label=\"{n}\"]"),
        ],
        "checkbox" => vec![
            format!("input[type='checkbox'][aria-label=\"{n}\"]"),
            format!("[role='checkbox'][aria-label=\"{n}\"]"),
        ],
        "radio" => vec![
            format!("input[type='radio'][aria-label=\"{n}\"]"),
            format!("input[type='radio'][value=\"{n}\"]"),
        ],
        "combobox" | "listbox" => vec![
            format!("select[aria-label=\"{n}\"]"),
            format!("select[name=\"{n}\"]"),
            format!("[role='combobox'][aria-label=\"{n}\"]"),
        ],
        "tab" => vec![
            format!("[role='tab'][aria-label=\"{n}\"]"),
        ],
        _ => vec![
            format!("[role='{role}'][aria-label=\"{n}\"]"),
        ],
    }
}

/// XPath expressions ranked by specificity. Each is a single path — no `|` unions,
/// which cause chromiumoxide to return `Invalid search result range`.
fn xpath_candidates(role: &str, name: &str) -> Vec<String> {
    if name.is_empty() {
        return vec![format!("//*[@role='{role}']")];
    }

    let n = escape_xpath(name);

    match role {
        "button" | "menuitem" => vec![
            format!("//button[normalize-space(.)='{n}']"),
            format!("//button[@aria-label='{n}']"),
            format!("//input[@type='submit' and @value='{n}']"),
            format!("//input[@type='button' and @value='{n}']"),
            format!("//*[@role='button' and normalize-space(.)='{n}']"),
            format!("//*[@role='button' and @aria-label='{n}']"),
        ],
        "link" => vec![
            format!("//a[normalize-space(.)='{n}']"),
            format!("//a[@aria-label='{n}']"),
            format!("//*[@role='link' and normalize-space(.)='{n}']"),
        ],
        "textbox" | "searchbox" => vec![
            format!("//input[@placeholder='{n}']"),
            format!("//input[@aria-label='{n}']"),
            format!("//input[@name='{n}']"),
            format!("//textarea[@placeholder='{n}']"),
            format!("//textarea[@aria-label='{n}']"),
            format!("//*[@role='textbox' and @aria-label='{n}']"),
            // Label-based: find input whose associated <label> contains the name text.
            // Handles Angular/React forms where the name is only in the label, not the input attrs.
            format!("//input[@id=//label[contains(normalize-space(.), '{n}')]/@for]"),
            format!("//input[contains(@aria-describedby, 'label') and //label[contains(normalize-space(.), '{n}')]]"),
            format!("//label[contains(normalize-space(.), '{n}')]/..//input[not(@type='hidden')]"),
            format!("//label[contains(normalize-space(.), '{n}')]/following::input[1][not(@type='hidden')]"),
        ],
        "checkbox" => vec![
            format!("//input[@type='checkbox' and @aria-label='{n}']"),
            format!("//*[@role='checkbox' and @aria-label='{n}']"),
        ],
        "radio" => vec![
            format!("//input[@type='radio' and @aria-label='{n}']"),
            format!("//input[@type='radio' and @value='{n}']"),
        ],
        "combobox" | "listbox" => vec![
            format!("//select[@aria-label='{n}']"),
            format!("//select[@name='{n}']"),
            format!("//*[@role='combobox' and @aria-label='{n}']"),
        ],
        "tab" => vec![
            format!("//*[@role='tab' and normalize-space(.)='{n}']"),
            format!("//*[@role='tab' and @aria-label='{n}']"),
        ],
        _ => vec![
            format!("//*[@role='{role}' and normalize-space(.)='{n}']"),
            format!("//*[@role='{role}' and @aria-label='{n}']"),
        ],
    }
}

fn escape_xpath(s: &str) -> String {
    if !s.contains('\'') {
        return s.to_string();
    }
    let parts: String = s
        .split('\'')
        .map(|p| format!("'{p}'"))
        .collect::<Vec<_>>()
        .join(", \"'\", ");
    format!("concat({parts})")
}
