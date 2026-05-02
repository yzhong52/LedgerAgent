import { Command } from 'commander';
import { keychainSave, keychainLoad, keychainSaveApiKey, keychainLoadApiKey } from '../keychain';
import { loadConfig, saveConfig } from '../config';
import { prompt, promptPassword } from './utils';

export function makeConfigCommand(): Command {
  const cmd = new Command('config').description('Manage OpenVault configuration');

  cmd
    .command('gmail')
    .description('Save Gmail credentials for MFA email reading')
    .action(async () => {
      console.log(`
OpenVault can read MFA codes sent to your Gmail automatically, so you don't
have to copy-paste them during sync.

This requires a Gmail App Password — a 16-character code that lets OpenVault
read your email without needing your Google account password.

How to generate one:
  1. Go to https://myaccount.google.com/apppasswords
  2. Sign in and click "Create a new app password"
  3. Name it "OpenVault", click Create
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
