import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { runAgent, toolDone, MAX_TURNS } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, executeBrowserTool } from '../agent/browser';
import { ACCOUNT_TOOL } from '../agent/tools';
import {
  loadMemoryNotes, saveMemoryNotes, formatMemoryForPrompt,
  generateSessionNotes, type ToolEvent,
} from '../memory';

export const ACCOUNT_TYPES = [
  'Cash',
  'Chequing',
  'Credit',
  'FHSA',            // First Home Savings Account
  'LIF',             // Life Income Fund
  'Line of Credit',
  'LIRA',            // Locked-In Retirement Account
  'Mortgage',
  'RDSP',            // Registered Disability Savings Plan
  'RESP',            // Registered Education Savings Plan
  'RRIF',            // Registered Retirement Income Fund
  'RRSP',            // Registered Retirement Savings Plan
  'Savings',
  'TFSA',            // Tax-Free Savings Account
] as const;

export type AccountType = typeof ACCOUNT_TYPES[number];

// Behavioral category — orthogonal to type. Drives holdings sync and UI grouping.
export const ACCOUNT_CATEGORIES = [
  'Cash',               // Spendable money (chequing, savings, TFSA savings, etc.)
  'Credit',             // Liability (credit card, mortgage, line of credit)
  'Brokerage',          // Self-directed — user picks individual positions
  'Managed Investment', // Managed/robo-advisor — manager picks positions
] as const;

export type AccountCategory = typeof ACCOUNT_CATEGORIES[number];

export interface Account {
  name: string;
  accountId?: string;
  type?: AccountType;
  category?: AccountCategory;
  currency?: string;
  balance?: number;
}

const MEMORY_TASK = 'accounts';
const REPORT_ACCOUNTS = ACCOUNT_TOOL.REPORT_ACCOUNTS;

const REPORT_TOOL: Tool = {
  name: REPORT_ACCOUNTS,
  description: 'Report all accounts you found. Call this once you have collected all account names, types, and balances visible on the page.',
  input_schema: {
    type: 'object',
    properties: {
      accounts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:      { type: 'string', description: 'Account name or label' },
            accountId: { type: 'string', description: 'A unique account number or identifier if visible (e.g., the last 4 digits). Omit if not visible.' },
            type: {
              type: 'string',
              enum: ACCOUNT_TYPES,
              description: 'Account type or tax wrapper — e.g. "TFSA", "RRSP", "Chequing", "Savings", "Credit". Pick the closest match from the enum.',
            },
            category: {
              type: 'string',
              enum: ACCOUNT_CATEGORIES,
              description: 'Behavioral category. Use "Cash" for spending/savings accounts; "Credit" for liabilities (credit cards, mortgages, lines of credit); "Brokerage" for self-directed investment accounts where the user picks individual positions; "Managed Investment" for robo-advisor or professionally managed portfolios.',
            },
            currency: { type: 'string', description: 'ISO 4217 currency code if known, e.g. CAD, USD. Omit for default domestic currency.' },
            balance:  { type: 'number', description: 'Current balance as a plain number, e.g. 12345.67 or -500. Omit currency symbols and commas.' },
          },
          required: ['name'],
        },
      },
    },
    required: ['accounts'],
  },
};

const TOOLS = [...BROWSER_TOOLS, REPORT_TOOL];

// Tools whose outcomes are recorded as ToolEvents and later summarized into
// per-institution memory. Include any tool where success/failure is worth
// remembering for future sessions (e.g. "use click_js here, not click").
const TRACKED_TOOLS = new Set<string>([
  BROWSER_TOOL.CLICK, BROWSER_TOOL.CLICK_TESTID, BROWSER_TOOL.CLICK_TEXT,
  BROWSER_TOOL.CLICK_JS, BROWSER_TOOL.FILL_JS, BROWSER_TOOL.PRESS_ENTER,
  BROWSER_TOOL.FRAME_SNAPSHOT, BROWSER_TOOL.GET_INPUTS,
]);

function buildSystemPrompt(
  notes: string,
  existingAccounts: Pick<Account, 'name' | 'type' | 'currency' | 'accountId'>[]
): string {
  let existingAccountsMsg = '';
  if (existingAccounts && existingAccounts.length > 0) {
    existingAccountsMsg = `\nPreviously seen accounts for this institution:\n` +
      existingAccounts.map(a => `- "${a.name}" (ID: ${a.accountId || 'none'}, Type: ${a.type || 'unknown'}, Currency: ${a.currency || 'unknown'})`).join('\n') +
      `\n\nIMPORTANT: If you see an account that matches one of the above, please report it using the exact same name and ID from this list to prevent duplicates. If it has a new ID or doesn't match, treat it as a new account.\n`;
  }

  return `\
You are a browser automation agent. The user has just logged into their financial institution and the dashboard is visible.

Your job is to find all accounts on the page — including their names, types, categories, currency (if non-default, e.g. USD), and balances.

Steps:
1. The current page state is already provided — identify all account entries.
2. They typically appear as a list with a label and a dollar amount.
3. If accounts are behind a tab or link (e.g. "All accounts", "Holdings"), click it.
4. Once you have a complete list, call report_accounts with all the accounts you found.
   - Set "type" to the tax wrapper or account style (e.g. "TFSA", "RRSP", "Chequing", "Savings", "Credit").
   - Set "category" based on what the account does: "Cash" for everyday banking/savings, "Credit" for liabilities, "Brokerage" for self-directed investment accounts, "Managed Investment" for managed/robo-advisor portfolios. A TFSA can be Cash or Brokerage depending on whether it holds securities.
   - Set "currency" to the ISO 4217 code (e.g. "USD") only when the account is in a non-default foreign currency. Omit it for domestic accounts.
${existingAccountsMsg}
Do not navigate away from the dashboard. Do not click login/logout links.
${formatMemoryForPrompt(notes, 'accounts')}`;
}

export async function exploreAccounts(
  page: Page,
  institutionName: string,
  sessionDir: string,
  existingAccounts: Pick<Account, 'name' | 'type' | 'currency' | 'accountId'>[] = [],
): Promise<Account[]> {
  console.log('🤖 Exploring accounts...');

  const notes = await loadMemoryNotes(institutionName, MEMORY_TASK);
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  try {
    return await runAgent<Account[]>(
      page,
      TOOLS,
      buildSystemPrompt(notes, existingAccounts),
      'The user is now logged in.',
      async (name, input, pg) => {
        if (name === REPORT_ACCOUNTS) {
          track('report_accounts', 'success');
          const accounts = (input as { accounts: Account[] }).accounts;
          return toolDone<Account[]>(accounts, 'accounts recorded');
        }

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
      },
      sessionDir,
      'conversation_accounts',
      [],
      MAX_TURNS,
      1024,
    );
  } finally {
    if (events.length > 0) {
      console.log('🤖 Summarizing session...');
      const sessionNotes = await generateSessionNotes(
        events, 'exploring a financial institution dashboard to discover all accounts',
      );
      await saveMemoryNotes(institutionName, MEMORY_TASK, sessionNotes);
    }
  }
}
