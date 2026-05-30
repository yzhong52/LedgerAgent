import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import {
  runAgent, toolDone, toolResult, MAX_TURNS, SEPARATOR,
  type ToolContinue, type ToolDone,
} from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, executeBrowserTool } from '../agent/browser';
import { ACCOUNT_TOOL } from '../agent/tools';
import type { ModelOptions } from '../agent/model_providers/types';
import { callForText } from '../agent/model_providers';
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
  'External',                // Account held at another institution, linked here for reference only
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
                '- Use "External" for accounts held at another institution that are linked here only for reference (e.g. a linked bank account used for transfers). Do not use this for accounts that are native to the current institution.',
                '- Use "General" for accounts that do not fit any of the above categories.',
                '- Use "Unknown" only if the category cannot be determined from the page.',
              ].join('\n'),
            },
            currency: { type: 'string', description: 'ISO 4217 currency code if known, e.g. CAD, USD. Omit for default domestic currency.' },
            balance:  { type: 'number', description: [
              'Current balance as a plain number. Omit currency symbols and commas.',
              'For Credit accounts (credit cards, lines of credit, mortgages), determine the direction from context — do NOT mirror the page sign blindly:',
              '- If the page shows a plain positive amount with no special label (e.g. "$6,830.88 balance", "Amount due: $6,830.88"), you OWE that amount → report as NEGATIVE (e.g. -6830.88).',
              '- If the page explicitly says "credit balance", "overpayment", "CR", or similar — the institution owes YOU → report as POSITIVE.',
              '- If you see a minus sign or the word "outstanding" / "owing", that confirms you owe money → report as NEGATIVE.',
            ].join(' ') },
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

async function resolveAccountIds(
  discovered: Account[],
  existing: ExistingAccountHint[],
  model: string,
  modelOptions: ModelOptions,
): Promise<Account[]> {
  const withIds = existing.filter(e => e.institutionAccountId);
  if (withIds.length === 0) return discovered;

  const existingList = existing
    .map((e, i) => `${i}: "${e.name}"${e.institutionAccountId ? ` (ID: ${e.institutionAccountId})` : ' (no ID)'}`)
    .join('\n');
  const discoveredList = discovered
    .map((a, i) => `${i}: "${a.name}"${a.accountId ? ` (ID: ${a.accountId})` : ' (no ID)'}`)
    .join('\n');

  const prompt = `\
You are reconciling newly discovered bank accounts against existing database records to prevent duplicates.

Existing accounts in database:
${existingList}

Newly discovered accounts:
${discoveredList}

For each discovered account (by index), find its best match among the existing accounts by name.
Names may differ slightly in spacing, emoji, capitalisation, or phrasing but still refer to the same account.
Return a JSON array with exactly ${discovered.length} entries — one per discovered account, in order:
[{"existingId": "id-or-null"}, ...]
Set "existingId" to the matching existing account's ID, or null if the account is genuinely new.
Return ONLY valid JSON, no other text.`;

  try {
    const raw = await callForText(model, prompt, 512, modelOptions);
    const cleaned = raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
    const matches: { existingId: string | null }[] = JSON.parse(cleaned);
    if (!Array.isArray(matches) || matches.length !== discovered.length) return discovered;
    return discovered.map((account, i) => {
      const existingId = matches[i]?.existingId;
      return existingId && typeof existingId === 'string'
        ? { ...account, accountId: existingId }
        : account;
    });
  } catch {
    return discovered;
  }
}

export async function exploreAccounts(
  page: Page,
  institutionName: string,
  sessionDir: string,
  existingAccounts: ExistingAccountHint[] = [],
  model: string,
  modelOptions: ModelOptions,
): Promise<Account[]> {
  console.log(SEPARATOR);
  console.log('🤖 Exploring accounts... ⏳');

  const notes = await loadMemoryNotes(institutionName, MEMORY_TASK);
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  try {
    const handleToolCall = handleAccountToolCall.bind(null, { track });

    const accounts = await runAgent<Account[]>(
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
    if (existingAccounts.length > 0) {
      console.log('🤖 Resolving account IDs... ⏳');
      return await resolveAccountIds(accounts, existingAccounts, model, modelOptions);
    }
    return accounts;
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
