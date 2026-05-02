import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { BROWSER_TOOL } from './tools';

export { BROWSER_TOOL };

export const BROWSER_TOOLS: Tool[] = [
  {
    name: BROWSER_TOOL.SNAPSHOT,
    description: 'Return the current page accessibility tree. Call this after any navigation or click to see updated state.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: BROWSER_TOOL.CLICK,
    description: 'Click an element identified by its ARIA role and accessible name. Pass frame when the element is inside an iframe.',
    input_schema: {
      type: 'object',
      properties: {
        role:  { type: 'string', description: 'ARIA role, e.g. button, link' },
        name:  { type: 'string', description: 'Accessible name of the element' },
        frame: { type: 'string', description: 'CSS selector for the containing iframe, if any' },
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
    description: 'Click an element using a CSS selector. Use as a last resort when click fails. Pass frame when the element is inside an iframe.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element' },
        frame:    { type: 'string', description: 'CSS selector for the containing iframe, if any' },
      },
      required: ['selector'],
    },
  },
  {
    name: BROWSER_TOOL.FRAME_SNAPSHOT,
    description: 'Return the accessibility tree of an iframe. Use when the main snapshot shows an iframe — call this to see what is inside it before trying to interact with its contents.',
    input_schema: {
      type: 'object',
      properties: {
        frame: { type: 'string', description: 'CSS selector for the iframe element, e.g. "#lmsIframe"' },
      },
      required: ['frame'],
    },
  },
  {
    name: BROWSER_TOOL.GET_INPUTS,
    description: 'Return all input elements with their HTML attributes (id, name, type, placeholder). Pass frame to search inside an iframe.',
    input_schema: {
      type: 'object',
      properties: {
        frame: { type: 'string', description: 'CSS selector for an iframe to search inside, e.g. "#lmsIframe". Omit to search the main page.' },
      },
    },
  },
  {
    name: BROWSER_TOOL.FILL_JS,
    description: 'Fill a form field by CSS selector. Use after get_inputs to fill fields that have no accessible name. Pass frame when the input is inside an iframe.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input, e.g. "#userId"' },
        value:    { type: 'string', description: 'Value to fill' },
        frame:    { type: 'string', description: 'CSS selector for the containing iframe, if any' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: BROWSER_TOOL.PRESS_ENTER,
    description: 'Press the Enter key on an element identified by ARIA role and name. Use to submit forms when clicking the submit button fails. Pass frame when the element is inside an iframe.',
    input_schema: {
      type: 'object',
      properties: {
        role:  { type: 'string' },
        name:  { type: 'string' },
        frame: { type: 'string', description: 'CSS selector for the containing iframe, if any' },
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

    case BROWSER_TOOL.CLICK: {
      const clickLocator = input.frame
        ? page.frameLocator(input.frame as string).getByRole(input.role as Parameters<typeof page.getByRole>[0], { name: input.name as string })
        : byRole(page, input);
      await clickLocator.click({ timeout: 5000 });
      await afterClick(page);
      return `clicked ${input.role} "${input.name}"`;
    }

    case BROWSER_TOOL.CLICK_TESTID:
      await page.getByTestId(input.testId as string).click({ timeout: 5000 });
      await afterClick(page);
      return `clicked [data-testid="${input.testId}"]`;

    case BROWSER_TOOL.CLICK_TEXT: {
      const exact = input.exact !== false;
      await page.getByText(input.text as string, { exact }).click({ timeout: 5000 });
      await afterClick(page);
      return `clicked text "${input.text}"`;
    }

    case BROWSER_TOOL.CLICK_JS: {
      const jsTarget = input.frame
        ? page.frameLocator(input.frame as string).locator(input.selector as string)
        : page.locator(input.selector as string);
      await jsTarget.first().evaluate((el: HTMLElement) => el.click());
      await afterClick(page);
      return `js-clicked "${input.selector}"`;
    }

    case BROWSER_TOOL.FRAME_SNAPSHOT:
      return page.frameLocator(input.frame as string).locator('body').ariaSnapshot();

    case BROWSER_TOOL.GET_INPUTS: {
      const locator = input.frame
        ? page.frameLocator(input.frame as string).locator('input, textarea, select')
        : page.locator('input, textarea, select');
      const inputs = await locator.evaluateAll((els) =>
        els.map((el) => {
          const e = el as HTMLInputElement;
          return { type: e.type || el.tagName.toLowerCase(), id: e.id, name: e.name, placeholder: e.placeholder };
        }),
      );
      return inputs.map((f, i) =>
        `[${i}] type=${f.type}${f.id ? ` id=${f.id}` : ''}${f.name ? ` name=${f.name}` : ''}${f.placeholder ? ` placeholder="${f.placeholder}"` : ''}`,
      ).join('\n');
    }

    case BROWSER_TOOL.FILL_JS: {
      const target = input.frame
        ? page.frameLocator(input.frame as string).locator(input.selector as string)
        : page.locator(input.selector as string);
      await target.fill(input.value as string, { timeout: 5000 });
      return `filled "${input.selector}"${input.frame ? ` in ${input.frame}` : ''}`;
    }

    case BROWSER_TOOL.PRESS_ENTER: {
      const enterLocator = input.frame
        ? page.frameLocator(input.frame as string).getByRole(input.role as Parameters<typeof page.getByRole>[0], { name: input.name as string })
        : byRole(page, input);
      await enterLocator.press('Enter', { timeout: 5000 });
      await afterClick(page);
      return `pressed Enter on ${input.role} "${input.name}"`;
    }

    default:
      return `unknown tool: ${name}`;
  }
}
