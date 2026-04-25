import { chromium } from 'playwright';
import * as fs from 'fs/promises';
import * as readline from 'readline';

const LOGIN_URL = 'https://my.wealthsimple.com/app/login?locale=en-ca';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await fs.mkdir('logs', { recursive: true });

  const snap = async (label: string) => {
    const tree = await page.locator('body').ariaSnapshot();
    await fs.writeFile(`logs/ws_${label}.txt`, tree);
    console.log(`saved logs/ws_${label}.txt`);
  };

  await page.goto(LOGIN_URL, { waitUntil: 'load' });
  await snap('login');

  const alreadyLoggedIn = !(await page.getByRole('textbox', { name: /Log in email/i })
    .isVisible({ timeout: 2000 }).catch(() => false));

  if (alreadyLoggedIn) {
    console.log('already logged in — skipping login flow');
  } else {
    console.log('login form detected — signing in...');

    const email = process.env.OPENVAULT_WS_USERNAME ?? await prompt('Email: ');
    const password = process.env.OPENVAULT_WS_PASSWORD ?? await prompt('Password: ');

    await page.getByRole('textbox', { name: /Log in email/i }).fill(email);
    await page.getByRole('textbox', { name: /Password/i }).fill(password);
    await page.getByTestId('login-form-submit-ftux').click();

    await page.waitForLoadState('load');

    const needsMfa = await page.getByRole('textbox', { name: /Enter your code/i })
      .isVisible({ timeout: 3000 }).catch(() => false);

    if (needsMfa) {
      await snap('mfa');
      const otp = await prompt('Enter 6-digit verification code: ');
      await page.getByRole('textbox', { name: /Enter your code/i }).fill(otp.trim());
      await page.getByRole('button', { name: /Submit/i }).click();
      await page.waitForLoadState('load');
    }
  }

  await snap('dashboard');

  await prompt('Press Enter to close... ');
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
