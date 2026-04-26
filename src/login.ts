import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { chromium, type Page } from 'playwright';
import * as fs from 'fs/promises';
import * as readline from 'readline';

// Set DEBUG=1 to log each message sent to Claude and pause 1s between tool calls.
const DEBUG = process.env.DEBUG === '1';

function debug(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// The login flow moves through these states in order.
// Claude signals each transition by calling the corresponding tool.
type LoginState = 'login_form' | 'mfa' | 'success';

interface Credentials {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildSystemPrompt(creds: Credentials): string {
  return `\
You are a browser automation agent. Your job is to log into a financial institution website.

Credentials to use:
  Email / username: ${creds.email}
  Password:         ${creds.password}

Login flow:
  1. Identify the login form fields and fill in the credentials above.
  2. Submit the form.
  3. If a multi-factor authentication (MFA) or verification code screen appears,
     call request_mfa_code with a short description of what the user should do.
     The tool returns the code the user typed — fill it in and submit.
  4. Once you can see the account dashboard or portfolio summary, call success.

Always call snapshot after submitting a form or clicking a button so you can
see the updated page state before deciding what to do next.`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'snapshot',
    description: 'Return the current page accessibility tree. Call this after any navigation or click to see updated state.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'fill',
    description: 'Fill a form field identified by its ARIA role and accessible name.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ARIA role, e.g. textbox, combobox' },
        name: { type: 'string', description: 'Accessible name of the field (label text)' },
        value: { type: 'string' },
      },
      required: ['role', 'name', 'value'],
    },
  },
  {
    name: 'click',
    description: 'Click an element identified by its ARIA role and accessible name.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ARIA role, e.g. button, link' },
        name: { type: 'string', description: 'Accessible name of the element' },
      },
      required: ['role', 'name'],
    },
  },
  {
    name: 'click_testid',
    description: 'Click an element by its data-testid attribute. Use this when click fails with a strict mode violation (multiple elements matched).',
    input_schema: {
      type: 'object',
      properties: {
        testId: { type: 'string' },
      },
      required: ['testId'],
    },
  },
  {
    name: 'request_mfa_code',
    description: 'Pause and ask the user to provide an MFA / verification code. Returns the code the user entered.',
    input_schema: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'Short message shown to the user, e.g. "Enter the 6-digit code sent to your phone"' },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'success',
    description: 'Signal that login is complete and the dashboard is visible. Call this as soon as you can see the account overview.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  input: Record<string, string>,
  page: Page,
): Promise<{ output: string; done: boolean }> {
  switch (name) {
    case 'snapshot': {
      const tree = await page.locator('body').ariaSnapshot();
      return { output: tree, done: false };
    }

    case 'fill': {
      const role = input.role as Parameters<typeof page.getByRole>[0];
      await page.getByRole(role, { name: input.name }).fill(input.value);
      return { output: `filled ${input.role} "${input.name}"`, done: false };
    }

    case 'click': {
      const role = input.role as Parameters<typeof page.getByRole>[0];
      await page.getByRole(role, { name: input.name }).click();
      // Use a short timeout — SPA navigation won't fire a full 'load' event.
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      return { output: `clicked ${input.role} "${input.name}"`, done: false };
    }

    case 'click_testid': {
      await page.getByTestId(input.testId).click();
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      return { output: `clicked [data-testid="${input.testId}"]`, done: false };
    }

    case 'request_mfa_code': {
      const code = await promptUser(`\n${input.instructions}\nCode: `);
      return { output: code.trim(), done: false };
    }

    case 'success':
      return { output: 'login complete', done: true };

    default:
      return { output: `unknown tool: ${name}`, done: false };
  }
}

// ---------------------------------------------------------------------------
// Login agent
// ---------------------------------------------------------------------------

const MODEL = 'claude-sonnet-4-6';
const MAX_TURNS = 30;

async function login(page: Page, url: string, creds: Credentials): Promise<void> {
  const client = new Anthropic();  // reads ANTHROPIC_API_KEY from env

  await page.goto(url, { waitUntil: 'load' });
  const initialSnapshot = await page.locator('body').ariaSnapshot();

  const messages: MessageParam[] = [
    {
      role: 'user',
      content: `The browser has navigated to the login page. Here is the current accessibility snapshot:\n\n${initialSnapshot}`,
    },
  ];

  console.log('agent: starting login...');

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastMessage = messages[messages.length - 1];
    debug('\n── prompt to claude ──────────────────────────────');
    debug(JSON.stringify(lastMessage, null, 2));
    debug('──────────────────────────────────────────────────\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(creds),
      tools: TOOLS,
      tool_choice: { type: 'any' },
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    // Execute every tool_use and collect results — the API requires one
    // tool_result per tool_use in the next message, no exceptions.
    const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
    let done = false;

    for (const toolUse of toolUses) {
      if (toolUse.type !== 'tool_use') continue;

      console.log(`[tool] ${toolUse.name}`, toolUse.input);

      let output: string;
      let toolDone = false;
      try {
        ({ output, done: toolDone } = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, string>,
          page,
        ));
      } catch (err) {
        output = `error: ${err instanceof Error ? err.message : String(err)}`;
      }

      console.log(`[tool] → ${output.length > 120 ? output.slice(0, 120) + '…' : output}`);
      if (DEBUG) await sleep(1000);

      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
      if (toolDone) { done = true; break; }
    }

    messages.push({ role: 'user', content: toolResults });

    if (done) {
      console.log('agent: login complete');
      return;
    }
  }

  throw new Error('agent did not complete login within turn limit');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function snap(page: Page, label: string): Promise<void> {
  const tree = await page.locator('body').ariaSnapshot();
  await fs.writeFile(`logs/ws_${label}.txt`, tree);
  console.log(`saved logs/ws_${label}.txt`);
}

// ---------------------------------------------------------------------------
// Wealthsimple entry point
// ---------------------------------------------------------------------------

const WS_LOGIN_URL = 'https://my.wealthsimple.com/app/login?locale=en-ca';

async function main() {
  const email    = process.env.OPENVAULT_WS_USERNAME ?? await promptUser('Email: ');
  const password = process.env.OPENVAULT_WS_PASSWORD ?? await promptUser('Password: ');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await fs.mkdir('logs', { recursive: true });

  await login(page, WS_LOGIN_URL, { email, password });
  await snap(page, 'dashboard');

  await promptUser('Press Enter to close... ');
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
