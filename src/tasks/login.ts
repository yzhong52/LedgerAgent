import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import * as readline from 'readline';
import { runAgent, toolDone, MAX_TURNS, SEPARATOR } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, byRole, executeBrowserTool } from '../agent/browser';
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

function buildSystemPrompt(notes: string): string {
  return `\
You are a browser automation agent. Your job is to log into a financial institution website.

Login flow:
  1. The current page state is already provided — use it to identify the login form fields.
  2. Use fill_username to enter the username and fill_password (or type_password for fields
     that require key events) to enter the password, then submit the form.
  3. If a multi-factor authentication (MFA) or verification code screen appears,
     call request_mfa_code with a short description of what the user should do.
     The tool returns the code — use the type tool (not fill) to enter it, then submit.
  4. If a "Remember this device", "Trust this device", or similar checkbox or button
     appears at any point, click or check it before proceeding. This avoids MFA prompts
     on future logins.
  5. Once you can see the account dashboard or portfolio summary, call success.

After each action, the updated page state is provided automatically.${formatMemoryForPrompt(notes, 'login')}`;
}


// Either (role + name) or selector must be provided. JSON Schema can't express
// "one of two alternatives" as a required constraint, so required is left empty and
// the mutual exclusivity is communicated to Claude via the field descriptions instead.
// If Claude omits both, credLocator will call getByRole(undefined) and Playwright will
// throw — that error is returned to Claude as a tool result so it can retry correctly.
const credFieldSchema = {
  type: 'object' as const,
  properties: {
    role:     { type: 'string', description: 'ARIA role, e.g. textbox, combobox. Use with name to locate by accessibility tree. Provide either role+name or selector.' },
    name:     { type: 'string', description: 'Accessible name of the field (label text). Required when using role.' },
    selector: { type: 'string', description: 'CSS selector, e.g. "#userId". Use when the field has no accessible name and role+name matching fails.' },
    frame:    { type: 'string', description: 'CSS selector of the iframe containing the field, e.g. "#loginFrame". Omit if the field is in the main frame.' },
  },
  required: [],
};

const LOGIN_TOOLS: Tool[] = [
  {
    name: LOGIN_TOOL.FILL_USERNAME,
    description: 'Fill the username or email field. The actual value is injected locally and never sent to this model.',
    input_schema: credFieldSchema,
  },
  {
    name: LOGIN_TOOL.FILL_PASSWORD,
    description: 'Fill the password field. The actual value is injected locally and never sent to this model.',
    input_schema: credFieldSchema,
  },
  {
    name: LOGIN_TOOL.TYPE_USERNAME,
    description: 'Type the username character-by-character, firing real key events. Use when key events are required to enable the submit button. The actual value is injected locally and never sent to this model.',
    input_schema: credFieldSchema,
  },
  {
    name: LOGIN_TOOL.TYPE_PASSWORD,
    description: 'Type the password character-by-character, firing real key events. Use when key events are required to enable the submit button. The actual value is injected locally and never sent to this model.',
    input_schema: credFieldSchema,
  },
  {
    name: LOGIN_TOOL.FILL,
    description: 'Fill a non-credential form field identified by its ARIA role and accessible name. Do not use this for username or password.',
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
    description: 'Type text into a non-credential field character-by-character, firing real key events. Use for OTP / verification code fields where key events are required to enable the submit button. Do not use this for username or password.',
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
  page: Page, url: string, creds: Credentials, institutionName: string, sessionDir: string,
): Promise<void> {
  const loginStartedAt = new Date();
  const notes = await loadMemoryNotes(institutionName, 'login');
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  await page.goto(url, { waitUntil: 'load' });

  console.log(SEPARATOR);
  console.log('🤖 Starting login... ⏳');

  let loginSucceeded = false;
  try {
    await runAgent<void>(
      page,
      TOOLS,
      buildSystemPrompt(notes),
      'The browser has navigated to the login page.',
      async (name, input, pg) => {
        // Resolves the locator for a credential field. Some sites (e.g. Questrade) use
        // inputs with no accessible name, so ARIA role/name matching fails — CSS selector
        // is the fallback. Some sites (e.g. Schwab) embed the login form in an iframe,
        // requiring frameLocator before any getByRole/locator call.
        const credLocator = (i: Record<string, unknown>) => {
          const frame = i.frame as string | undefined;
          const root = frame ? pg.frameLocator(frame) : pg;
          return i.selector
            ? root.locator(i.selector as string)
            : root.getByRole(i.role as Parameters<typeof pg.getByRole>[0], { name: i.name as string });
        };
        const credDesc = (i: Record<string, unknown>) =>
          i.selector ? String(i.selector) : `${i.role} "${i.name}"`;

        switch (name) {
          case LOGIN_TOOL.FILL_USERNAME:
            await credLocator(input).fill(creds.username, { timeout: 5000 });
            track(`fill_username(${credDesc(input)})`, 'success');
            return `filled ${credDesc(input)} with username`;
          case LOGIN_TOOL.FILL_PASSWORD:
            await credLocator(input).fill(creds.password, { timeout: 5000 });
            track(`fill_password(${credDesc(input)})`, 'success');
            return `filled ${credDesc(input)} with password`;
          case LOGIN_TOOL.TYPE_USERNAME:
            await credLocator(input).pressSequentially(creds.username, { timeout: 5000 });
            track(`type_username(${credDesc(input)})`, 'success');
            return `typed username into ${credDesc(input)}`;
          case LOGIN_TOOL.TYPE_PASSWORD:
            await credLocator(input).pressSequentially(creds.password, { timeout: 5000 });
            track(`type_password(${credDesc(input)})`, 'success');
            return `typed password into ${credDesc(input)}`;
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
      sessionDir,
      'conversation_login',
      [creds.username, creds.password],
      MAX_TURNS,
      1024,
    );
  } finally {
    if (events.length > 0) {
      console.log('🤖 Summarizing session... ⏳');
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
