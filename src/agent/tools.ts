/** Central registry of tool name constants.
 *  Import from here rather than defining string literals inline so that
 *  every reference to a tool name is a single, trackable symbol. */

export const BROWSER_TOOL = {
  SNAPSHOT:        'snapshot',
  FRAME_SNAPSHOT:  'frame_snapshot',
  GET_INPUTS:      'get_inputs',
  CLICK:           'click',
  CLICK_TESTID:    'click_testid',
  CLICK_TEXT:      'click_text',
  CLICK_JS:        'click_js',
  FILL_JS:         'fill_js',
  PRESS_ENTER:     'press_enter',
} as const;

export const LOGIN_TOOL = {
  FILL:             'fill',
  TYPE:             'type',
  REQUEST_MFA_CODE: 'request_mfa_code',
  SUCCESS:          'success',
} as const;

export const ACCOUNT_TOOL = {
  REPORT_ACCOUNTS: 'report_accounts',
} as const;

export const TRANSACTION_TOOL = {
  REPORT_TRANSACTIONS: 'report_transactions',
} as const;

/** Shared terminal tool name — tasks call this to signal completion. */
export const SUCCESS_TOOL = LOGIN_TOOL.SUCCESS;
