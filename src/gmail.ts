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

  console.log('Checking Gmail for MFA code...');

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      let attempt = 0;
      while (Date.now() < deadline) {
        // NOOP flushes pending server notifications so new messages appear in SEARCH
        await client.noop();
        const code = await searchForCode(client, since);
        if (code) return code;
        if (++attempt % 5 === 0) console.log('Still waiting for MFA email...');
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.warn(`Gmail check failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.logout().catch(() => {});
  }

  return null;
}

export function extractMfaCode(text: string): string | null {
  // Try contextual match first — avoids matching SMS shortcodes or phone numbers
  // that appear earlier in the raw email source (e.g. "From: 864674").
  const contextual = text.match(
    /(?:security code|verification code|one.time.{0,6}code|otp|passcode)\D{0,10}(\d{4,8})/i,
  );
  if (contextual) return contextual[1];
  const fallback = text.match(/\b(\d{6})\b/);
  return fallback ? fallback[1] : null;
}

async function searchForCode(client: ImapFlow, since: Date): Promise<string | null> {
  // IMAP SINCE is day-granular; we filter by exact internalDate after fetching
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const uids = await client.search({ since: today }, { uid: true });
  if (!uids || uids.length === 0) return null;

  const range = uids.slice(-10).join(',');
  for await (const msg of client.fetch(
    range, { internalDate: true, source: true }, { uid: true },
  )) {
    if (!msg.internalDate || msg.internalDate < since || !msg.source) continue;
    const code = extractMfaCode(msg.source.toString());
    if (code) return code;
  }

  return null;
}
