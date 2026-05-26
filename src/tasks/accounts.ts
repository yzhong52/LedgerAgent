import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import {
  runAgent, toolDone, toolResult, MAX_TURNS, SEPARATOR,
  type ToolContinue, type ToolDone,
} from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, executeBrowserTool } from '../agent/browser';
import { ACCOUNT_TOOL } from '../agent/tools';
import type { ModelOptions } from '../agent/model_providers/types';
import {
  loadMemoryNotes, saveMemoryNotes, formatMemoryForPrompt,
  generateSessionNotes, type ToolEvent,
} from '../memory';

export const ACCOUNT_TYPES = [
  'General',         // No special tax wrapper (chequing, savings, credit card, brokerage cash, etc.)
  'FHSA',            // First Home Savings Account
  'LIF',             // Life Income Fund
  'LIRA',            // Locked-In Retirement Account
  'RDSP',            // Registered Disability Savings Plan
  'RESP',            // Registered Education Savings Plan
  'RRIF',            // Registered Retirement Income Fund
  'RRSP',            // Registered Retirement Savings Plan
  'TFSA',            // Tax-Free Savings Account
  'Unknown',         // Cannot determine from available page information
] as const;

export type AccountType = typeof ACCOUNT_TYPES[number];

// Behavioral category — orthogonal to type. Drives holdings sync and UI grouping.
// Active categories used by the agent:
export const ACCOUNT_CATEGORIES = [
  'Cash',                   // Spendable money (chequing, savings, TFSA savings, etc.)
  'Credit',                 // Liability (credit card, mortgage, line of credit)
  'Self-Directed Investing', // User picks individual positions
  'Managed Investing',       // Robo-advisor or professionally managed
  'General',                 // Catch-all when no other category fits
  'Unknown',                 // Cannot determine from available page information
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
  description: 'Report all accounts found. Navigate all tabs and sections first, then call this once with the complete list to finish.',
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
              description: [
                'Registered account type or tax wrapper.',
                'Use "General" for any account without a special government registration (chequing, savings, credit card, non-registered brokerage, etc.).',
                'Use "Unknown" only if the registration type cannot be determined from the page.',
              ].join(' '),
            },
            category: {
              type: 'string',
              enum: ACCOUNT_CATEGORIES,
              description: [
                'Behavioral category used for account classification:',
                '- Use "Cash" for spending and savings accounts, including chequing accounts, savings accounts, and TFSA savings accounts.',
                ' Cash accounts do not hold investment assets such as stocks or ETFs.',
                ' If you see profolio, P&L, self-directed, etc. then it cannot be Cash account.',
                '- Use "Credit" for liabilities such as credit cards, mortgages, and lines of credit.',
                '- Use "Self-Directed Investing" for investment accounts where the user selects and manages individual positions.',
                '- Use "Managed Investing" for robo-advisor accounts or professionally managed portfolios.',
                '- Use "General" for accounts that do not fit any of the above categories.',
                '- Use "Unknown" only if the category cannot be determined from the page.',
              ].join('\n'),
            },
            currency: { type: 'string', description: 'ISO 4217 currency code if known, e.g. CAD, USD. Omit for default domestic currency.' },
            balance:  { type: 'number', description: 'Current balance as a plain number. Omit currency symbols and commas. For Credit accounts (credit cards, lines of credit, mortgages): report negative when you owe money (normal carry, e.g. -500 for a $500 balance owed), report positive only when the institution owes you (e.g. overpayment credit). Do not mirror the page sign blindly — use the semantic direction.' },
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

type TrackToolEvent = (
  description: string,
  outcome: 'success' | 'error',
  error?: string,
) => void;

interface AccountToolContext {
  track: TrackToolEvent;
}

export interface ExistingAccountHint {
  dbId: number;
  name: string;
  institutionAccountId?: string;
}

function formatExistingAccountsHint(existingAccounts: ExistingAccountHint[]): string {
  if (existingAccounts.length === 0) {
    return '';
  }

  const accountList = existingAccounts
    .map(({ dbId, name, institutionAccountId }) => {
      const institutionId = institutionAccountId
        ? `, Institution ID: ${institutionAccountId}`
        : '';

      return `- "${name}" (DB ID: ${dbId}${institutionId})`;
    })
    .join('\n');

  return `
Previously seen accounts for this institution:
${accountList}

IMPORTANT: If you see an account that matches one of the above, please report it using the exact same name and Institution ID from this list to prevent duplicates.
If it has a new ID or doesn't match, treat it as a new account.
`;
}

function buildSystemPrompt(notes: string, existingAccounts: ExistingAccountHint[]): string {
  const existingAccountsHint = formatExistingAccountsHint(existingAccounts);

  return `\
You are a browser automation agent. The user has just logged into their financial institution and the dashboard is visible.

Your job is to find all accounts — including their names, types, categories, currency (if non-default, e.g. USD), and balances.

Steps:
1. The current page state is already provided — identify all account entries visible now.
2. Accounts typically appear as a list with a label and a dollar amount.
3. If more accounts are behind a tab or link (e.g. "All accounts", "Holdings"), click through all sections first.
4. Once you have explored all sections, call report_accounts once with the complete list of all accounts found.

For investment accounts, report the 'Total equity' if available instead of 'Market value' or 'Cash' or 'Buying power'.

${existingAccountsHint}
Do not navigate away from the dashboard. Do not click login/logout links.
${formatMemoryForPrompt(notes, 'accounts')}`;
}

async function handleAccountToolCall(
  { track }: AccountToolContext,
  name: string,
  input: Record<string, unknown>,
  pg: Page,
): Promise<ToolContinue | ToolDone<Account[]>> {
  if (name === REPORT_ACCOUNTS) {
    const accounts = (input as { accounts: Account[] }).accounts;
    track('report_accounts', 'success');
    return toolDone<Account[]>(accounts, `done — ${accounts.length} accounts collected`);
  }

  if (TRACKED_TOOLS.has(name)) {
    const desc = input.role
      ? `${name}(${input.role} "${input.name}")`
      : `${name}(${JSON.stringify(input)})`;
    try {
      const result = await executeBrowserTool(name, input, pg);
      track(desc, 'success');
      return toolResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      track(desc, 'error', msg);
      throw err;
    }
  }

  return toolResult(await executeBrowserTool(name, input, pg));
}

export async function exploreAccounts(
  page: Page,
  institutionName: string,
  sessionDir: string,
  existingAccounts: ExistingAccountHint[] = [],
  model: string,
  modelOptions: ModelOptions = {},
): Promise<Account[]> {
  console.log(SEPARATOR);
  console.log('🤖 Exploring accounts... ⏳');

  const notes = await loadMemoryNotes(institutionName, MEMORY_TASK);
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  try {
    const handleToolCall = handleAccountToolCall.bind(null, { track });

    return await runAgent<Account[]>(
      page,
      TOOLS,
      buildSystemPrompt(notes, existingAccounts),
      handleToolCall,
      sessionDir,
      'accounts',
      [],
      MAX_TURNS,
      1024,
      model,
      modelOptions,
    );
  } finally {
    if (events.length > 0) {
      console.log('🤖 Summarizing session... ⏳');
      const sessionNotes = await generateSessionNotes(
        events, 'exploring a financial institution dashboard to discover all accounts',
        model, notes, modelOptions,
      );
      await saveMemoryNotes(institutionName, MEMORY_TASK, sessionNotes);
    }
  }
}
