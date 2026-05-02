import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import * as readline from 'readline';
import { runAgent, toolDone } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, byRole, executeBrowserTool } from '../agent/browser';
import { loadPageCache } from '../agent/cache';
import { LOGIN_TOOL } from '../agent/tools';
import { fetchMfaCode } from '../gmail';
import {
  loadMemoryNotes, saveMemoryNotes, formatMemoryForPrompt,
  generateSessionNotes, type ToolEvent,
} from '../memory';

export interface Credentials {
  username: string;
  password: string;
}

function buildSystemPrompt(creds: Credentials, notes: string): string {
  return `\
You are a browser automation agent. Your job is to log into a financial institution website.

Credentials to use:
  Username: ${creds.username}
  Password: ${creds.password}

Login flow:
  1. An initial accessibility snapshot is already provided — use it to identify the login form fields.
  2. Fill in the credentials above and submit the form.
  3. If a multi-factor authentication (MFA) or verification code screen appears,
     call request_mfa_code with a short description of what the user should do.
     The tool returns the code — use the type tool (not fill) to enter it, then submit.
  4. If a "Remember this device", "Trust this device", or similar checkbox or button
     appears at any point, click or check it before proceeding. This avoids MFA prompts
     on future logins.
  5. Once you can see the account dashboard or portfolio summary, call success.

After each action, the updated page state is provided automatically.${formatMemoryForPrompt(notes, 'login')}`;
}

const LOGIN_TOOLS: Tool[] = [
  {
    name: LOGIN_TOOL.FILL,
    description: 'Fill a form field identified by its ARIA role and accessible name.',
    input_schema: {
      type: 'object',
      properties: {
        role:  { type: 'string', description: 'ARIA role, e.g. textbox, combobox' },
        name:  { type: 'string', description: 'Accessible name of the field (label text)' },
        value: { type: 'string' },
      },
      required: ['role', 'name', 'value'],
    },
  },
  {
    name: LOGIN_TOOL.TYPE,
    description: 'Type text into a field character-by-character, firing real key events. Use this instead of fill for OTP / verification code fields where key events are required to enable the submit button.',
    input_schema: {
      type: 'object',
      properties: {
        role:  { type: 'string' },
        name:  { type: 'string' },
        value: { type: 'string' },
      },
      required: ['role', 'name', 'value'],
    },
  },
  {
    name: LOGIN_TOOL.REQUEST_MFA_CODE,
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
    name: LOGIN_TOOL.SUCCESS,
    description: 'Signal that login is complete and the dashboard is visible. Call this as soon as you can see the account overview.',
    input_schema: { type: 'object', properties: {} },
  },
];

const TOOLS = [...BROWSER_TOOLS, ...LOGIN_TOOLS];

// Tools whose outcomes are recorded as ToolEvents and later summarized into
// per-institution memory. Include any tool where success/failure is worth
// remembering for future sessions (e.g. "use click_js here, not click").
const TRACKED_TOOLS = new Set<string>([
  BROWSER_TOOL.CLICK, BROWSER_TOOL.CLICK_TESTID, BROWSER_TOOL.CLICK_TEXT,
  BROWSER_TOOL.CLICK_JS, BROWSER_TOOL.FILL_JS, BROWSER_TOOL.PRESS_ENTER,
  BROWSER_TOOL.FRAME_SNAPSHOT, BROWSER_TOOL.GET_INPUTS,
]);

export async function login(
  page: Page, url: string, creds: Credentials, institutionName: string,
): Promise<void> {
  const loginStartedAt = new Date();
  const [notes, pageCache] = await Promise.all([
    loadMemoryNotes(institutionName, 'login'),
    loadPageCache(institutionName, 'login'),
  ]);
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  await page.goto(url, { waitUntil: 'load' });
  const initialSnapshot = await page.locator('body').ariaSnapshot();

  console.log('🤖 Starting login...');

  let loginSucceeded = false;
  try {
    await runAgent<void>(
      page,
      TOOLS,
      buildSystemPrompt(creds, notes),
      `The browser has navigated to the login page. Here is the current accessibility snapshot:\n\n${initialSnapshot}`,
      async (name, input, pg) => {
        switch (name) {
          case LOGIN_TOOL.FILL:
            await byRole(pg, input).fill(input.value as string, { timeout: 5000 });
            track(`fill(${input.role} "${input.name}")`, 'success');
            return `filled ${input.role} "${input.name}"`;
          case LOGIN_TOOL.TYPE:
            await byRole(pg, input).pressSequentially(input.value as string, { timeout: 5000 });
            track(`type(${input.role} "${input.name}")`, 'success');
            return `typed into ${input.role} "${input.name}"`;
          case LOGIN_TOOL.REQUEST_MFA_CODE: {
            console.log(`\n${input.instructions as string}`);
            const code = await fetchMfaCode(loginStartedAt) ?? (await promptUser('Code: ')).trim();
            track('request_mfa_code', 'success');
            return code;
          }
          case LOGIN_TOOL.SUCCESS: {
            loginSucceeded = true;
            return toolDone<void>(undefined, 'login complete');
          }
          default:
            if (TRACKED_TOOLS.has(name)) {
              const desc = input.role
                ? `${name}(${input.role} "${input.name}")`
                : `${name}(${JSON.stringify(input)})`;
              try {
                const result = await executeBrowserTool(name, input, pg);
                track(desc, 'success');
                return result;
              } catch (err) {
                const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
                track(desc, 'error', msg);
                throw err;
              }
            }
            return executeBrowserTool(name, input, pg);
        }
      },
      { pageCache, initialSnapshot },
    );
  } finally {
    if (events.length > 0) {
      console.log('🤖 Summarizing session...');
      const sessionNotes = await generateSessionNotes(
        events, 'logging into a financial institution website',
      );
      await saveMemoryNotes(institutionName, 'login', sessionNotes);
    }
  }

  if (loginSucceeded) console.log('🤖 Login complete 🎉');
}

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}
