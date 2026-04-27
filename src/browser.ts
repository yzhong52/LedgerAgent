import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export const BROWSER_TOOL = {
  SNAPSHOT:     'snapshot',
  CLICK:        'click',
  CLICK_TESTID: 'click_testid',
  CLICK_TEXT:   'click_text',
  CLICK_JS:     'click_js',
  PRESS_ENTER:  'press_enter',
} as const;

export const BROWSER_TOOLS: Tool[] = [
  {
    name: BROWSER_TOOL.SNAPSHOT,
    description: 'Return the current page accessibility tree. Call this after any navigation or click to see updated state.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: BROWSER_TOOL.CLICK,
    description: 'Click an element identified by its ARIA role and accessible name.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ARIA role, e.g. button, link' },
        name: { type: 'string', description: 'Accessible name of the element' },
      },
      required: ['role', 'name'],
    },
  },
  {
    name: BROWSER_TOOL.CLICK_TESTID,
    description: 'Click an element by its data-testid attribute. Use when click fails with a strict mode violation (multiple elements matched).',
    input_schema: {
      type: 'object',
      properties: {
        testId: { type: 'string' },
      },
      required: ['testId'],
    },
  },
  {
    name: BROWSER_TOOL.CLICK_TEXT,
    description: 'Click an element by its visible text content. Use when the button ARIA name is unclear or does not match visible text.',
    input_schema: {
      type: 'object',
      properties: {
        text:  { type: 'string', description: 'Visible text of the element to click' },
        exact: { type: 'boolean', description: 'Match text exactly (default true)' },
      },
      required: ['text'],
    },
  },
  {
    name: BROWSER_TOOL.CLICK_JS,
    description: 'Click an element using a JavaScript querySelector. Use as a last resort when Playwright click fails due to visibility or overlap checks.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element' },
      },
      required: ['selector'],
    },
  },
  {
    name: BROWSER_TOOL.PRESS_ENTER,
    description: 'Press the Enter key on an element identified by ARIA role and name. Use to submit forms when clicking the submit button fails.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['role', 'name'],
    },
  },
];

// Locates an element by ARIA role and accessible name from a tool input.
export function byRole(page: Page, input: Record<string, unknown>) {
  return page.getByRole(
    input.role as Parameters<typeof page.getByRole>[0],
    { name: input.name as string },
  );
}

// SPAs don't fire a second 'load' event during in-app navigation; domcontentloaded is safe.
async function afterClick(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
}

export async function executeBrowserTool(
  name: string,
  input: Record<string, unknown>,
  page: Page,
): Promise<string> {
  switch (name) {
    case BROWSER_TOOL.SNAPSHOT:
      return page.locator('body').ariaSnapshot();

    case BROWSER_TOOL.CLICK:
      await byRole(page, input).click();
      await afterClick(page);
      return `clicked ${input.role} "${input.name}"`;

    case BROWSER_TOOL.CLICK_TESTID:
      await page.getByTestId(input.testId as string).click();
      await afterClick(page);
      return `clicked [data-testid="${input.testId}"]`;

    case BROWSER_TOOL.CLICK_TEXT: {
      const exact = input.exact !== false;
      await page.getByText(input.text as string, { exact }).click();
      await afterClick(page);
      return `clicked text "${input.text}"`;
    }

    case BROWSER_TOOL.CLICK_JS:
      await page.$eval(input.selector as string, (el: HTMLElement) => el.click());
      await afterClick(page);
      return `js-clicked "${input.selector}"`;

    case BROWSER_TOOL.PRESS_ENTER:
      await byRole(page, input).press('Enter');
      await afterClick(page);
      return `pressed Enter on ${input.role} "${input.name}"`;

    default:
      return `unknown tool: ${name}`;
  }
}
