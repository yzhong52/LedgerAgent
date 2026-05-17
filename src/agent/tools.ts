/** Central registry of tool name constants.
 *  Import from here rather than defining string literals inline so that
 *  every reference to a tool name is a single, trackable symbol. */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

/** Generic done tool — signals the agent has finished collecting all items. */
export const DONE_TOOL = 'done';

export const DONE_TOOL_DEF: Tool = {
  name: DONE_TOOL,
  description: 'Signal that you have finished exploring all sections and reported all items. Call this once all report_* calls are done.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const BROWSER_TOOL = {
  SNAPSHOT:        'snapshot',
  FRAME_SNAPSHOT:  'frame_snapshot',
  GET_INPUTS:      'get_inputs',
  CLICK:           'click',
  CLICK_TESTID:    'click_testid',
  CLICK_TEXT:      'click_text',
  CLICK_JS:        'click_js',
  CLICK_REF:       'click_ref',
  FILL_JS:         'fill_js',
  FILL_REF:        'fill_ref',
  TYPE_JS:         'type_js',
  TYPE_REF:        'type_ref',
  PRESS_ENTER:     'press_enter',
} as const;

/** Shared terminal tool — all tasks call this to signal completion. */
export const SUCCESS_TOOL = 'success';

/** Shared give-up tool — call when stuck or the target resource is unavailable. */
export const GIVE_UP_TOOL = 'give_up';

export const LOGIN_TOOL = {
  // FILL / TYPE: for non-credential fields (e.g. OTP codes, search boxes).
  // FILL_USERNAME / FILL_PASSWORD / TYPE_USERNAME / TYPE_PASSWORD: same mechanics, but the
  //   executor injects the credential value locally so it is never sent to the model.
  // FILL* uses Playwright fill() (sets value directly, no key events).
  // TYPE* uses pressSequentially() (fires keydown/keyup/input per character — required for
  //   SPA fields that gate the submit button on real keystroke events).
  FILL:             'fill',
  TYPE:             'type',
  FILL_USERNAME:    'fill_username',
  FILL_PASSWORD:    'fill_password',
  TYPE_USERNAME:    'type_username',
  TYPE_PASSWORD:    'type_password',
  REQUEST_MFA_CODE: 'request_mfa_code',
  SUCCESS:          SUCCESS_TOOL,
} as const;

export const ACCOUNT_TOOL = {
  REPORT_ACCOUNTS: 'report_accounts',
} as const;

export const TRANSACTION_TOOL = {
  REPORT_TRANSACTIONS: 'report_transactions',
} as const;

export const HOLDING_TOOL = {
  REPORT_HOLDINGS: 'report_holdings',
} as const;

/** Tools that modify page or form state. The agent loop takes an implicit snapshot
 *  after each one so the cache can fingerprint the result without waiting for Claude
 *  to explicitly call the snapshot tool. */
export const STATE_CHANGING_TOOLS = new Set<string>([
  BROWSER_TOOL.CLICK,
  BROWSER_TOOL.CLICK_TESTID,
  BROWSER_TOOL.CLICK_TEXT,
  BROWSER_TOOL.CLICK_JS,
  BROWSER_TOOL.CLICK_REF,
  BROWSER_TOOL.FILL_JS,
  BROWSER_TOOL.FILL_REF,
  BROWSER_TOOL.TYPE_JS,
  BROWSER_TOOL.TYPE_REF,
  BROWSER_TOOL.PRESS_ENTER,
  LOGIN_TOOL.FILL,
  LOGIN_TOOL.TYPE,
  LOGIN_TOOL.FILL_USERNAME,
  LOGIN_TOOL.FILL_PASSWORD,
  LOGIN_TOOL.TYPE_USERNAME,
  LOGIN_TOOL.TYPE_PASSWORD,
]);
