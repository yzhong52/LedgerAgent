import { Command } from 'commander';
import { keychainSave, keychainLoad, keychainSaveApiKey, keychainLoadApiKey } from '../keychain';
import { loadConfig, saveConfig } from '../config';
import { fetchMfaCode } from '../gmail';
import { DEFAULT_MODEL } from '../agent/model_providers';
import { prompt, promptPassword } from './utils';

export function makeConfigCommand(): Command {
  const cmd = new Command('config').description('Manage LedgerAgent configuration');

  cmd
    .command('gmail')
    .description('Save Gmail credentials for MFA email reading')
    .action(async () => {
      console.log(`
LedgerAgent can read MFA codes sent to your Gmail automatically, so you don't
have to copy-paste them during sync.

This requires a Gmail App Password — a 16-character code that lets LedgerAgent
read your email without needing your Google account password.

How to generate one:
  1. Go to https://myaccount.google.com/apppasswords
  2. Sign in and click "Create a new app password"
  3. Name it "LedgerAgent", click Create
  4. Copy the 16-character password shown (no spaces)

More info: faq/how_to_config_gmail_for_mfa.md
`);
      const existing = await loadConfig();
      const existingEmail = existing.gmailAddress ?? '';

      const emailInput = await prompt(
        existingEmail ? `Gmail address [${existingEmail}]: ` : 'Gmail address: ',
      );
      const newEmail = emailInput.trim() || existingEmail;

      const existingPassword = newEmail ? (keychainLoad('gmail', newEmail) ?? '') : '';
      const maskedPassword = existingPassword.length >= 2
        ? existingPassword[0] + '*'.repeat(existingPassword.length - 2) + existingPassword.at(-1)
        : existingPassword ? '*'.repeat(existingPassword.length) : '';
      const passwordInput = await promptPassword(
        maskedPassword
          ? `App Password [${maskedPassword}]: `
          : 'App Password (16 chars, no spaces): ',
      );
      const newPassword = passwordInput.trim() || existingPassword;

      if (!newEmail || !newPassword) {
        console.log('Aborted — email and password are both required.');
        return;
      }

      await saveConfig({ gmailAddress: newEmail });
      keychainSave('gmail', newEmail, newPassword);
      console.log(`Saved Gmail credentials for ${newEmail}`);
    });

  cmd
    .command('gmail-test')
    .description('Test Gmail IMAP connection and search recent emails for MFA codes')
    .option('--since <duration>', 'how far back to search (e.g. 5m, 30m, 1h)', '5m')
    .option('--model <id>', 'Model ID to use for extraction', DEFAULT_MODEL)
    .action(async (opts: { since: string; model: string }) => {
      const ms = parseDuration(opts.since);
      if (ms === null) {
        console.log(`Invalid --since value "${opts.since}". Use a duration like 5m, 30m, or 1h.`);
        return;
      }
      const config = await loadConfig();
      if (!config.gmailAddress) {
        console.log('No Gmail address configured. Run: config gmail');
        return;
      }
      const password = keychainLoad('gmail', config.gmailAddress);
      if (!password) {
        console.log(`No app password found for ${config.gmailAddress}. Run: config gmail`);
        return;
      }
      console.log(`Gmail address : ${config.gmailAddress}`);
      console.log('Keychain      : password found');
      console.log('Connecting to imap.gmail.com...');
      const since = new Date(Date.now() - ms);
      const code = await fetchMfaCode(since, opts.model, ({ sender, subject, date, extractedCode }) => {
        const ageMs = Date.now() - date.getTime();
        const ago = ageMs < 60000 ? '<1m ago' : `${Math.round(ageMs / 60000)}m ago`;
        const withinWindow = date >= since;
        const marker = withinWindow ? '-' : '–';
        console.log(`  ${marker} "${subject}" from ${sender} (${ago})`);
        if (withinWindow) {
          console.log(extractedCode ? `     ✅ MFA code found: ${extractedCode}` : '     ❌ no code found');
        } else {
          console.log('     ⏭️  skipped (outside time window)');
        }
      });
      if (code) {
        console.log(`✅ MFA code found: ${code}`);
      } else {
        console.log(`⚠️  No MFA code found in the last ${opts.since} (this is normal if no code was sent).`);
      }
    });

  cmd
    .command('anthropic')
    .description('Save Anthropic API key to Keychain')
    .action(async () => {
      const existingKey = keychainLoadApiKey() ?? '';
      const maskedKey = existingKey.length >= 2
        ? existingKey[0] + '*'.repeat(existingKey.length - 2) + existingKey.at(-1)
        : existingKey ? '*'.repeat(existingKey.length) : '';
      const keyInput = await promptPassword(
        maskedKey ? `Anthropic API key [${maskedKey}]: ` : 'Anthropic API key (sk-ant-...): ',
      );
      const newKey = keyInput.trim() || existingKey;
      if (!newKey) {
        console.log('Aborted — API key is required.');
        return;
      }
      keychainSaveApiKey(newKey);
      console.log('Saved Anthropic API key to Keychain.');
    });

  return cmd;
}

function parseDuration(s: string): number | null {
  const m = s.match(/^(\d+)(m|h)$/);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  return m[2] === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
}
