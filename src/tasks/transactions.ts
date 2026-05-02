import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { runAgent, toolDone } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, executeBrowserTool } from '../agent/browser';
import { loadPageCache } from '../agent/cache';
import { TRANSACTION_TOOL } from '../agent/tools';
import { loadMemoryNotes, saveMemoryNotes, formatMemoryForPrompt, generateSessionNotes, type ToolEvent } from '../memory';

export interface Transaction {
  date: string;
  description: string;
  amount: string;
  accountName: string;
}

const MEMORY_TASK = 'transactions';
const REPORT_TRANSACTIONS = TRANSACTION_TOOL.REPORT_TRANSACTIONS;

const REPORT_TOOL: Tool = {
  name: REPORT_TRANSACTIONS,
  description: 'Report all transactions you found. Call this once you have collected all recent transactions for the account.',
  input_schema: {
    type: 'object',
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date:        { type: 'string', description: 'Transaction date as displayed, e.g. "2025-04-28"' },
            description: { type: 'string', description: 'Transaction description or merchant name' },
            amount:      { type: 'string', description: 'Transaction amount as displayed, e.g. "-$12.50" or "+$1,000.00"' },
            accountName: { type: 'string', description: 'Name of the account this transaction belongs to' },
          },
          required: ['date', 'description', 'amount', 'accountName'],
        },
      },
    },
    required: ['transactions'],
  },
};

const TOOLS = [...BROWSER_TOOLS, REPORT_TOOL];

const TRACKED_TOOLS = new Set<string>([
  BROWSER_TOOL.CLICK, BROWSER_TOOL.CLICK_TESTID, BROWSER_TOOL.CLICK_TEXT,
  BROWSER_TOOL.CLICK_JS, BROWSER_TOOL.FILL_JS, BROWSER_TOOL.PRESS_ENTER,
  BROWSER_TOOL.FRAME_SNAPSHOT, BROWSER_TOOL.GET_INPUTS,
]);

function buildSystemPrompt(notes: string): string {
  return `\
You are a browser automation agent. The user has just logged into their financial institution and the dashboard is visible.

Your job is to find recent transactions across all accounts.

Steps:
1. An initial accessibility snapshot is already provided — use it to identify where to find transactions.
2. Navigate to the transactions or activity section for each account.
3. Collect all visible transactions — date, description, and amount.
4. Once you have collected all transactions, call report_transactions.

Do not navigate away from the institution's site. Do not click login/logout links.${formatMemoryForPrompt(notes, 'transactions')}`;
}

// TODO: implement fetchTransactions and integrate it into the sync pipeline (src/commands/sync.ts)
export async function fetchTransactions(page: Page, institutionName: string): Promise<Transaction[]> {
  console.log('🤖 fetching transactions...');

  const [notes, pageCache] = await Promise.all([
    loadMemoryNotes(institutionName, MEMORY_TASK),
    loadPageCache(institutionName, MEMORY_TASK),
  ]);
  const events: ToolEvent[] = [];
  const initialSnapshot = await page.locator('body').ariaSnapshot();

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  try {
    return await runAgent<Transaction[]>(
      page,
      TOOLS,
      buildSystemPrompt(notes),
      `The user is now logged in. Here is the current accessibility snapshot:\n\n${initialSnapshot}`,
      async (name, input, pg) => {
        if (name === REPORT_TRANSACTIONS) {
          track('report_transactions', 'success');
          return toolDone<Transaction[]>((input as { transactions: Transaction[] }).transactions, 'transactions recorded');
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
            track(desc, 'error', err instanceof Error ? err.message.split('\n')[0] : String(err));
            throw err;
          }
        }

        return executeBrowserTool(name, input, pg);
      },
      { pageCache, initialSnapshot },
    );
  } finally {
    if (events.length > 0) {
      console.log('🤖 Summarizing session...');
      const sessionNotes = await generateSessionNotes(events, 'fetching recent transactions from a financial institution');
      await saveMemoryNotes(institutionName, MEMORY_TASK, sessionNotes);
    }
  }
}
