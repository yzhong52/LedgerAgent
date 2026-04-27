import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { runAgent, toolDone } from './agent';
import { BROWSER_TOOLS, executeBrowserTool } from './browser';

export interface Account {
  name: string;
  type?: string;
  balance?: string;
}

const REPORT_ACCOUNTS = 'report_accounts';

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
            name:    { type: 'string', description: 'Account name or label' },
            type:    { type: 'string', description: 'Account type, e.g. TFSA, RRSP, chequing' },
            balance: { type: 'string', description: 'Current balance as displayed, e.g. "$12,345.67"' },
          },
          required: ['name'],
        },
      },
    },
    required: ['accounts'],
  },
};

const TOOLS = [...BROWSER_TOOLS, REPORT_TOOL];

const SYSTEM_PROMPT = `\
You are a browser automation agent. The user has just logged into their financial institution and the dashboard is visible.

Your job is to find all accounts on the page — including their names, types (e.g. TFSA, RRSP, chequing, savings), and balances.

Steps:
1. Call snapshot to see the current page state.
2. Identify all account entries. They typically appear as a list with a label and a dollar amount.
3. If the accounts are behind a tab or link (e.g. "All accounts", "Holdings"), click it and snapshot again.
4. Once you have a complete list, call report_accounts with all the accounts you found.

Do not navigate away from the dashboard. Do not click login/logout links.`;

export async function findAccounts(page: Page): Promise<Account[]> {
  console.log('agent: finding accounts...');

  return runAgent<Account[]>(
    page,
    TOOLS,
    SYSTEM_PROMPT,
    'The user is now logged in. Please find all accounts on the dashboard.',
    async (name, input, pg) => {
      if (name === REPORT_ACCOUNTS) {
        return toolDone<Account[]>((input as { accounts: Account[] }).accounts, 'accounts recorded');
      }
      return executeBrowserTool(name, input, pg);
    },
  );
}
