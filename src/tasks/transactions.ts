import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { runAgent, toolDone } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, executeBrowserTool } from '../agent/browser';
import { TRANSACTION_TOOL } from '../agent/tools';
import {
  loadMemoryNotes, saveMemoryNotes, formatMemoryForPrompt,
  generateSessionNotes, type ToolEvent,
} from '../memory';
import type { Account } from './accounts';

export interface Transaction {
  date: string;           // YYYY-MM-DD
  description: string;
  amount: number;         // signed float; negative = debit
  transactionId?: string; // institution-provided ID if visible
  currency?: string;      // ISO 4217; omit for domestic
}

const MEMORY_TASK = 'transactions';
const REPORT_TRANSACTIONS = TRANSACTION_TOOL.REPORT_TRANSACTIONS;
const MAX_TURNS = 40;

const REPORT_TOOL: Tool = {
  name: REPORT_TRANSACTIONS,
  description:
    'Report all transactions you found. Call this once you have collected all transactions ' +
    'for the requested date range — including any paginated results.',
  input_schema: {
    type: 'object',
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Transaction date in YYYY-MM-DD format.',
            },
            description: {
              type: 'string',
              description: 'Merchant or payee name as it appears on the statement.',
            },
            amount: {
              type: 'number',
              description:
                'Signed amount as a plain number. Negative for debits (money out), ' +
                'positive for credits (money in). No currency symbols or commas.',
            },
            transactionId: {
              type: 'string',
              description:
                'Institution-provided transaction ID if visible on the page. Omit if not shown.',
            },
            currency: {
              type: 'string',
              description: 'ISO 4217 code (e.g. USD). Omit for domestic currency.',
            },
          },
          required: ['date', 'description', 'amount'],
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

function buildSystemPrompt(
  notes: string,
  account: Pick<Account, 'name' | 'accountId'>,
  lookbackDays: number,
  sinceDate: string,
): string {
  const accountLabel = account.accountId
    ? `"${account.name}" (ID: ${account.accountId})`
    : `"${account.name}"`;

  return `\
You are a browser automation agent. The user is logged into their financial institution.

Your job is to find all transactions for the account ${accountLabel} from ${sinceDate} to today \
(the last ${lookbackDays} days).

Steps:
1. Navigate to the transaction history for this account. It may require clicking the account name, \
a "Transactions" or "Activity" tab, or a date-range filter.
2. Make sure the date range covers from ${sinceDate} to today. If there is a date filter, set it \
accordingly. If the default range already covers this period, that is fine.
3. Collect every transaction visible on the page.
4. If there is pagination (e.g. "Load more", "Next page", numbered pages), continue until you \
have collected all transactions back to ${sinceDate}.
5. Once you have everything, call ${REPORT_TRANSACTIONS} with the full list.
   - "amount" must be a signed number: negative for money leaving the account (purchases, \
withdrawals, fees), positive for money entering (deposits, refunds).
   - "date" must be YYYY-MM-DD.
   - "transactionId" should be included only if the institution shows a reference number or ID.

Do not navigate to other accounts. Do not log out.
${formatMemoryForPrompt(notes, MEMORY_TASK)}`;
}

export async function fetchTransactions(
  page: Page,
  institutionName: string,
  account: Pick<Account, 'name' | 'accountId'>,
  lookbackDays: number,
  sessionDir: string,
): Promise<Transaction[]> {
  console.log(`🤖 Fetching transactions for ${account.name}...`);

  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const notes = await loadMemoryNotes(institutionName, MEMORY_TASK);
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  try {
    return await runAgent<Transaction[]>(
      page,
      TOOLS,
      buildSystemPrompt(notes, account, lookbackDays, sinceDate),
      `Please fetch transactions for account ${account.name} from ${sinceDate} to today.`,
      async (name, input, pg) => {
        if (name === REPORT_TRANSACTIONS) {
          track('report_transactions', 'success');
          const txs = (input as { transactions: Transaction[] }).transactions;
          return toolDone<Transaction[]>(txs, 'transactions recorded');
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
      `conversation_transactions_${account.name.toLowerCase().replace(/\s+/g, '_')}`,
      [],
      MAX_TURNS,
    );
  } finally {
    if (events.length > 0) {
      console.log('🤖 Summarizing session...');
      const sessionNotes = await generateSessionNotes(
        events,
        `fetching transactions for account "${account.name}" at ${institutionName}`,
      );
      await saveMemoryNotes(institutionName, MEMORY_TASK, sessionNotes);
    }
  }
}
