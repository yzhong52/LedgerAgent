import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { runAgent, toolDone, toolResult, MAX_TURNS, SEPARATOR } from '../agent';
import { BROWSER_TOOL, BROWSER_TOOLS, executeBrowserTool } from '../agent/browser';
import { GIVE_UP_TOOL, HOLDING_TOOL } from '../agent/tools';
import type { ModelOptions } from '../agent/model_providers/types';
import {
  loadMemoryNotes, saveMemoryNotes, formatMemoryForPrompt,
  generateSessionNotes, type ToolEvent,
} from '../memory';
import type { Account } from './accounts';

export interface Holding {
  symbol: string;
  name?: string;
  quantity: number;
  pricePerUnit: number;  // plain dollars
  marketValue: number;   // plain dollars
  costBasis?: number;    // plain dollars; omitted if not shown
  currency?: string;     // ISO 4217; omit for CAD
}

const TASK_NAME = 'holdings';
const REPORT_HOLDINGS = HOLDING_TOOL.REPORT_HOLDINGS;

const REPORT_TOOL: Tool = {
  name: REPORT_HOLDINGS,
  description:
    'Report all holdings you found for this investment account. Call this once you have ' +
    'collected all positions visible on the page.',
  input_schema: {
    type: 'object',
    properties: {
      holdings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Ticker symbol or identifier, e.g. "XEQT", "AAPL", "BTC".',
            },
            name: {
              type: 'string',
              description: 'Display name of the holding, e.g. "iShares Core Equity ETF". Omit if not shown.',
            },
            quantity: {
              type: 'number',
              description: 'Number of units or shares held.',
            },
            pricePerUnit: {
              type: 'number',
              description: 'Current price per unit as a plain number (no currency symbols or commas).',
            },
            marketValue: {
              type: 'number',
              description: 'Total market value as a plain number. Should equal quantity × pricePerUnit.',
            },
            costBasis: {
              type: 'number',
              description: 'Total cost basis as a plain number, if shown. Omit if not visible.',
            },
            currency: {
              type: 'string',
              description: 'ISO 4217 code (e.g. "USD") if the holding is priced in a foreign currency. Omit for CAD.',
            },
          },
          required: ['symbol', 'quantity', 'pricePerUnit', 'marketValue'],
        },
      },
    },
    required: ['holdings'],
  },
};

// Some accounts exist only on mobile and have no web holdings view. For example, TD Easy Trade
// accounts do not appear in the WebBroker account selector at all — attempting to find them
// there will always fail. This tool gives the agent a clean exit in those cases.
const NOT_AVAILABLE_TOOL: Tool = {
  name: GIVE_UP_TOOL,
  description:
    'Call this when the account cannot be found in the account selector, has no holdings ' +
    'view on this platform, or you are stuck and cannot make progress. Do NOT use this if ' +
    'you simply haven\'t looked yet.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why you are giving up.' },
    },
    required: ['reason'],
  },
};

const TOOLS = [...BROWSER_TOOLS, REPORT_TOOL, NOT_AVAILABLE_TOOL];

const TRACKED_TOOLS = new Set<string>([
  BROWSER_TOOL.CLICK, BROWSER_TOOL.CLICK_TESTID, BROWSER_TOOL.CLICK_TEXT,
  BROWSER_TOOL.CLICK_JS, BROWSER_TOOL.FILL_JS, BROWSER_TOOL.PRESS_ENTER,
  BROWSER_TOOL.FRAME_SNAPSHOT, BROWSER_TOOL.GET_INPUTS,
]);

function buildSystemPrompt(
  notes: string,
  account: Pick<Account, 'name' | 'accountId'>,
): string {
  const accountLabel = account.accountId
    ? `"${account.name}" (ID: ${account.accountId})`
    : `"${account.name}"`;

  return `\
You are a browser automation agent. The user is logged into their financial institution.

Your job is to find all investment holdings for the account ${accountLabel} only if the \
account is available.

Steps:
1. Navigate to the holdings or portfolio view for this account. It may require clicking the \
account name, a "Holdings", "Portfolio", or "Positions" tab.
2. If the account is not avaiable, or there is no way to view holdings for this account on \
the web, call ${GIVE_UP_TOOL} with the reason. 
3. Once the account is identified, collect every position visible — symbol (or ticker), name, \
quantity, price per unit, and total market value. Include cost basis if shown.
4. If holdings span multiple pages or require expanding rows, navigate through all of them.
5. Once you have the complete list, call ${REPORT_HOLDINGS}. 
6. If this account has no individual positions (e.g. it is a cash-only account), report an empty 
holdings array.

Do not navigate to other accounts. Do not log out.
${formatMemoryForPrompt(notes, TASK_NAME)}`;
}

export async function exploreHoldings(
  page: Page,
  institutionName: string,
  account: Pick<Account, 'name' | 'accountId'>,
  sessionDir: string,
  model: string,
  modelOptions: ModelOptions = {},
): Promise<Holding[]> {
  console.log(SEPARATOR);
  console.log(`🤖 Fetching holdings for ${account.name}... ⏳`);

  const notes = await loadMemoryNotes(institutionName, TASK_NAME);
  const events: ToolEvent[] = [];

  const track = (description: string, outcome: 'success' | 'error', error?: string) =>
    events.push({ description, outcome, error });

  try {
    return await runAgent<Holding[]>(
      page,
      TOOLS,
      buildSystemPrompt(notes, account),
      async (name, input, pg) => {
        if (name === REPORT_HOLDINGS) {
          track('report_holdings', 'success');
          const raw = (input as { holdings: Holding[] }).holdings;
          const list = Array.isArray(raw) ? raw : [];
          return toolDone<Holding[]>(list, 'holdings recorded');
        }

        if (name === GIVE_UP_TOOL) {
          const reason = (input as { reason?: string }).reason ?? 'account not available on this platform';
          track('give_up', 'success');
          return toolDone<Holding[]>([], reason);
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
      },
      sessionDir,
      `holdings_${account.name.toLowerCase().replace(/\s+/g, '_')}`,
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
        events,
        `fetching investment holdings for account "${account.name}" at ${institutionName}`,
        model,
        notes,
        modelOptions,
      );
      await saveMemoryNotes(institutionName, TASK_NAME, sessionNotes);
    }
  }
}
