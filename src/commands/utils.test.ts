import { describe, it, expect, vi, beforeEach } from 'vitest';
import { printAccountsTable } from './utils';

describe('printAccountsTable', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { output.push(args.join(' ')); });
  });

  it('prefixes foreign currency in the balance column and omits a separate currency column', () => {
    printAccountsTable([
      { institution: 'Bank A',  account: 'Chequing',          type: 'Chequing', balance: '$1,234.56',  lastUpdated: '2026-05-01' },
      { institution: 'Bank A',  account: 'US Dollar Savings', type: 'Savings',  balance: '$100.00',    lastUpdated: '2026-05-01', currency: 'USD' },
      { institution: 'Bank A',  account: 'Credit Card',       type: 'Credit',   balance: '-$42.00',    lastUpdated: '2026-05-01' },
      { institution: 'Bank A',  account: 'USD Credit Card',   type: 'Credit',   balance: '-$10.00',    lastUpdated: '2026-05-01', currency: 'USD' },
      { institution: 'Bank B',  account: 'CAD Savings',       type: 'Savings',  balance: '$500.00',    lastUpdated: '2026-05-01', currency: 'CAD' },
      { institution: 'Bank B',  account: 'TFSA',              type: 'TFSA',     balance: '$9,999.99',  lastUpdated: '2026-05-01' },
    ], { demo: false, showInstitution: true });

    expect(output.join('\n')).toMatchInlineSnapshot(`
      "
        Institution  Account            Type          Balance  Last Updated
        -----------  -----------------  --------  -----------  ------------
        Bank A       Chequing           Chequing    $1,234.56  2026-05-01
        Bank A       US Dollar Savings  Savings   USD $100.00  2026-05-01
        Bank A       Credit Card        Credit        -$42.00  2026-05-01
        Bank A       USD Credit Card    Credit    USD -$10.00  2026-05-01
        Bank B       CAD Savings        Savings   CAD $500.00  2026-05-01
        Bank B       TFSA               TFSA        $9,999.99  2026-05-01
      "
    `);
  });
});
