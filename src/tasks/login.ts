import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import * as fs from 'fs/promises';
import * as readline from 'readline';
import { runAgent, toolDone } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, byRole, executeBrowserTool } from '../agent/browser';
import { fetchMfaCode } from '../gmail';

export interface Credentials {
  username: string;
  password: string;
}

function buildSystemPrompt(creds: Credentials): string {
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

Always call snapshot after submitting a form or clicking a button so you can
see the updated page state before deciding what to do next.`;
}

const LOGIN_TOOL = {
  FILL:             'fill',
  TYPE:             'type',
  REQUEST_MFA_CODE: 'request_mfa_code',
  SUCCESS:          'success',
} as const;

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

export async function login(page: Page, url: string, creds: Credentials): Promise<void> {
  const loginStartedAt = new Date();
  await page.goto(url, { waitUntil: 'load' });
  const initialSnapshot = await page.locator('body').ariaSnapshot();

  await fs.mkdir('logs', { recursive: true });
  const sessionTag = new URL(url).hostname.replace(/\./g, '_') + '_' + Date.now();
  let snapCount = 0;

  console.log('agent: starting login...');

  await runAgent<void>(
    page,
    TOOLS,
    buildSystemPrompt(creds),
    `The browser has navigated to the login page. Here is the current accessibility snapshot:\n\n${initialSnapshot}`,
    async (name, input, pg) => {
      if (name === BROWSER_TOOL.SNAPSHOT) {
        const snapshot = await executeBrowserTool(name, input, pg);
        const file = `logs/${sessionTag}_${String(++snapCount).padStart(3, '0')}.txt`;
        await fs.writeFile(file, snapshot);
        return snapshot;
      }

      if (name === LOGIN_TOOL.FILL) {
        await byRole(pg, input).fill(input.value as string);
        return `filled ${input.role} "${input.name}"`;
      }

      if (name === LOGIN_TOOL.TYPE) {
        await byRole(pg, input).pressSequentially(input.value as string);
        return `typed into ${input.role} "${input.name}"`;
      }

      if (name === LOGIN_TOOL.REQUEST_MFA_CODE) {
        console.log(`\n${input.instructions as string}`);
        const code = await fetchMfaCode(loginStartedAt) ?? (await promptUser('Code: ')).trim();
        return code;
      }

      if (name === LOGIN_TOOL.SUCCESS) {
        return toolDone<void>(undefined, 'login complete');
      }

      return executeBrowserTool(name, input, pg);
    },
  );

  console.log('agent: login complete');
}

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}
