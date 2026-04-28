import { ImapFlow } from 'imapflow';
import { keychainLoad } from './keychain';
import { loadConfig } from './config';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 60000;

// since is the login start time — only accept emails that arrived after login began,
// so codes from a previous session are never mistakenly reused.
export async function fetchMfaCode(since: Date): Promise<string | null> {
  const { gmailAddress } = await loadConfig();
  if (!gmailAddress) return null;

  const password = keychainLoad('gmail', gmailAddress);
  if (!password) return null;

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: gmailAddress, pass: password },
    logger: false,
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  process.stdout.write('Checking Gmail for MFA code');

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      while (Date.now() < deadline) {
        // NOOP flushes pending server notifications so new messages appear in SEARCH
        await client.noop();
        const code = await searchForCode(client, since);
        if (code) {
          process.stdout.write('\n');
          return code;
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.warn(`\nGmail check failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.logout().catch(() => {});
  }

  process.stdout.write('\n');
  return null;
}

async function searchForCode(client: ImapFlow, since: Date): Promise<string | null> {
  // IMAP SINCE is day-granular; we filter by exact internalDate after fetching
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const uids = await client.search({ since: today }, { uid: true });
  if (!uids || uids.length === 0) return null;

  const range = uids.slice(-10).join(',');
  for await (const msg of client.fetch(range, { internalDate: true, source: true }, { uid: true })) {
    if (!msg.internalDate || msg.internalDate < since || !msg.source) continue;
    const text = msg.source.toString();
    const match = text.match(/\b(\d{6})\b/);
    if (match) return match[1];
  }

  return null;
}
