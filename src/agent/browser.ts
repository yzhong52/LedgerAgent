import type { Page } from 'playwright';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { BROWSER_TOOL } from './tools';

export { BROWSER_TOOL };

export const BROWSER_TOOLS: Tool[] = [
  {
    name: BROWSER_TOOL.CLICK,
    description: 'Click an element by its ARIA role and accessible name. Example: to click a "Log in" button use role="button" name="Log in". Do NOT pass a "text" argument — use click_text for text-based matching. Pass frame when the element is inside an iframe. When multiple elements share the same role and name, pass nth (0-based) to pick the one you want — the order matches the ARIA snapshot top-to-bottom.',
    input_schema: {
      type: 'object',
      properties: {
        role:  { type: 'string', description: 'ARIA role, e.g. "button", "link", "checkbox"' },
        name:  { type: 'string', description: 'Accessible name exactly as shown in the snapshot, e.g. "Log in"' },
        nth:   { type: 'number', description: '0-based index when multiple elements share the same role+name. Matches snapshot order.' },
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
    description: 'Click an element by its visible text content. Use this instead of click when you only know the visible text and not the ARIA role.',
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
    name: BROWSER_TOOL.CLICK_REF,
    description: 'Click an element by its ref ID from the aria snapshot (e.g. "e42"). Prefer this over click when the ref is available — it targets the exact element unambiguously.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref ID from the aria snapshot, e.g. "e42"' },
      },
      required: ['ref'],
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
    name: BROWSER_TOOL.GET_INNER_TEXT,
    description: 'Return the visible rendered text of a DOM element by CSS selector — captures text that has no ARIA label and is therefore absent from the aria snapshot. Use when a value you need (e.g. a balance or label) is visible on screen but missing from the snapshot. Targets the first matching element; use a specific selector to avoid returning the entire page.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the container element, e.g. "main", "[class*=\'balance\']"' },
        frame:    { type: 'string', description: 'CSS selector for the containing iframe, if any' },
      },
      required: ['selector'],
    },
  },
  {
    name: BROWSER_TOOL.FILL_REF,
    description: 'Fill a form field by its ref ID from the aria snapshot. Prefer this over fill_js when the ref is available.',
    input_schema: {
      type: 'object',
      properties: {
        ref:   { type: 'string', description: 'The ref ID from the aria snapshot, e.g. "e42"' },
        value: { type: 'string', description: 'Value to fill' },
      },
      required: ['ref', 'value'],
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
    name: BROWSER_TOOL.TYPE_REF,
    description: 'Clear a field by ref ID then type character-by-character. Use for OTP or masked inputs that require keystroke events. Prefer this over type_js when the ref is available.',
    input_schema: {
      type: 'object',
      properties: {
        ref:   { type: 'string', description: 'The ref ID from the aria snapshot, e.g. "e42"' },
        value: { type: 'string', description: 'Value to type' },
      },
      required: ['ref', 'value'],
    },
  },
  {
    name: BROWSER_TOOL.TYPE_JS,
    description: 'Clear a field by CSS selector then type character-by-character. Use for masked/formatted inputs (e.g. date pickers) where fill_js appends instead of replacing, or where keystroke events are required to satisfy field validation.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input, e.g. "#input-daDtTransFrom"' },
        value:    { type: 'string', description: 'Value to type' },
        frame:    { type: 'string', description: 'CSS selector for the containing iframe, if any' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: BROWSER_TOOL.PRESS_ENTER,
    description: 'Press the Enter key on an element. Use to submit forms when clicking the submit button fails. Identify the element by ref (preferred) or role+name. Pass frame when the element is inside an iframe.',
    input_schema: {
      type: 'object',
      properties: {
        ref:   { type: 'string', description: 'ARIA ref from the snapshot, e.g. "e32". Preferred.' },
        role:  { type: 'string', description: 'ARIA role. Use with name when ref is unavailable.' },
        name:  { type: 'string', description: 'Accessible name. Use with role when ref is unavailable.' },
        frame: { type: 'string', description: 'CSS selector for the containing iframe, if any' },
      },
      required: [],
    },
  },
];

// Locates an element by ARIA role and accessible name from a tool input.
// Pass frame when the target element is inside an iframe (e.g. Schwab's #lmsIframe).
// Omit for elements in the main frame.
export function byRole(page: Page, input: Record<string, unknown>, frame?: string) {
  const root = frame ? page.frameLocator(frame) : page;
  return root.getByRole(
    input.role as Parameters<typeof page.getByRole>[0],
    { name: input.name as string },
  );
}

// SPAs don't fire a second 'load' event during in-app navigation; domcontentloaded is safe.
async function afterClick(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  // Waits for 500ms of no network activity — catches post-submit spinners (e.g. TD login)
  // that leave the page in a transitional state the model can't act on.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

export async function executeBrowserTool(
  name: string,
  input: Record<string, unknown>,
  page: Page,
): Promise<string> {
  switch (name) {
    case BROWSER_TOOL.CLICK: {
      let clickLocator = input.frame
        ? page.frameLocator(input.frame as string).getByRole(
          input.role as Parameters<typeof page.getByRole>[0],
          { name: input.name as string },
        )
        : byRole(page, input);
      if (typeof input.nth === 'number') clickLocator = clickLocator.nth(input.nth);
      await clickLocator.click({ timeout: 5000 });
      await afterClick(page);
      return `clicked ${input.role} "${input.name}"${typeof input.nth === 'number' ? ` [${input.nth}]` : ''}`;
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

    case BROWSER_TOOL.CLICK_REF: {
      await page.locator(`aria-ref=${input.ref}`).click({ timeout: 5000 });
      await afterClick(page);
      return `clicked ref=${input.ref}`;
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
      return page.frameLocator(input.frame as string).locator('body').ariaSnapshot({ mode: 'ai' });

    case BROWSER_TOOL.GET_INPUTS: {
      const locator = input.frame
        ? page.frameLocator(input.frame as string).locator('input, textarea, select')
        : page.locator('input, textarea, select');
      const inputs = await locator.evaluateAll((els) =>
        els.map((el) => {
          const e = el as HTMLInputElement;
          return {
            type: e.type || el.tagName.toLowerCase(),
            id: e.id,
            name: e.name,
            placeholder: e.placeholder,
          };
        }),
      );
      return inputs.map((f, i) =>
        `[${i}] type=${f.type}` +
          `${f.id ? ` id=${f.id}` : ''}` +
          `${f.name ? ` name=${f.name}` : ''}` +
          `${f.placeholder ? ` placeholder="${f.placeholder}"` : ''}`,
      ).join('\n');
    }

    case BROWSER_TOOL.GET_INNER_TEXT: {
      // innerText() reads what the browser has rendered to screen, including text inside elements
      // that carry no ARIA role or accessible name and therefore don't appear in ariaSnapshot.
      // Questrade's per-account equity values are one known example: the dollar amounts are
      // visible but the surrounding divs have no accessible labels, so they're invisible to the
      // AI snapshot mode.
      const textLocator = input.frame
        ? page.frameLocator(input.frame as string).locator(input.selector as string)
        : page.locator(input.selector as string);
      const text = await textLocator.first().innerText({ timeout: 5000 });
      const MAX = 4000;
      return text.length > MAX ? `${text.slice(0, MAX)}\n[truncated — ${text.length} chars total]` : text;
    }

    case BROWSER_TOOL.FILL_REF: {
      await page.locator(`aria-ref=${input.ref}`).fill(input.value as string, { timeout: 5000 });
      return `filled ref=${input.ref}`;
    }

    case BROWSER_TOOL.FILL_JS: {
      const target = input.frame
        ? page.frameLocator(input.frame as string).locator(input.selector as string)
        : page.locator(input.selector as string);
      await target.fill(input.value as string, { timeout: 5000 });
      return `filled "${input.selector}"${input.frame ? ` in ${input.frame}` : ''}`;
    }

    case BROWSER_TOOL.TYPE_REF: {
      const typeRefLocator = page.locator(`aria-ref=${input.ref}`);
      if (!await typeRefLocator.isEditable()) {
        return `error: ref=${input.ref} is not an editable element — target the textbox ref, not its label or container`;
      }
      await typeRefLocator.click({ timeout: 5000 });
      await typeRefLocator.press('Control+A');
      await typeRefLocator.press('Delete');
      await typeRefLocator.pressSequentially(input.value as string, { timeout: 5000 });
      return `typed into ref=${input.ref}`;
    }

    case BROWSER_TOOL.TYPE_JS: {
      const typeTarget = input.frame
        ? page.frameLocator(input.frame as string).locator(input.selector as string)
        : page.locator(input.selector as string);
      await typeTarget.click({ timeout: 5000 });
      await typeTarget.press('Control+A');
      await typeTarget.press('Delete');
      await typeTarget.pressSequentially(input.value as string, { timeout: 5000 });
      return `typed into "${input.selector}"${input.frame ? ` in ${input.frame}` : ''}`;
    }

    case BROWSER_TOOL.PRESS_ENTER: {
      const enterLocator = input.ref
        ? page.locator(`aria-ref=${input.ref as string}`)
        : input.frame
          ? page.frameLocator(input.frame as string).getByRole(
            input.role as Parameters<typeof page.getByRole>[0],
            { name: input.name as string },
          )
          : byRole(page, input);
      await enterLocator.press('Enter', { timeout: 5000 });
      await afterClick(page);
      const desc = input.ref ? `ref=${input.ref as string}` : `${input.role} "${input.name}"`;
      return `pressed Enter on ${desc}`;
    }

    default:
      return `unknown tool: ${name}`;
  }
}
