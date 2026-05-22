import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { keychainLoad } from './keychain';
import { loadConfig } from './config';
import { callForText } from './agent/model_providers';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 60000;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface EmailInfo {
  sender: string;
  subject: string;
  date: Date;
  extractedCode: string | null;
}

// since is the login start time — only accept emails that arrived after login began,
// so codes from a previous session are never mistakenly reused.
// Pass onEmailChecked to inspect every email scanned (used by gmail-test); also disables polling.
export async function fetchMfaCode(
  since: Date,
  onEmailChecked?: (info: EmailInfo) => void,
  model: string = DEFAULT_MODEL,
): Promise<string | null> {
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

  const deadline = onEmailChecked ? 0 : Date.now() + POLL_TIMEOUT_MS;

  console.log('Checking Gmail for MFA code... ⏳');

  try {
    await client.connect();
    const lock = await client.getMailboxLock('[Gmail]/All Mail');

    try {
      let attempt = 0;
      const seenUids = new Set<number>();
      do {
        // NOOP flushes pending server notifications so new messages appear in SEARCH
        await client.noop();
        const code = await searchForCode(client, since, model, seenUids, onEmailChecked);
        if (code) return code;
        if (onEmailChecked) break;
        if (++attempt % 5 === 0) console.log('Still waiting for MFA email... ⏳');
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      } while (Date.now() < deadline);
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

// Rejects codes that are all the same digit (000000, 111111, etc.).
function isObviouslyInvalid(code: string): boolean {
  return /^(\d)\1+$/.test(code);
}

async function extractMfaCodeAI(cleanedText: string, model: string): Promise<string | null> {
  const response = await callForText(
    model,
    `Extract the MFA or verification code from this email. Reply with ONLY the numeric code digits.
If there is no verification code, reply with exactly: none

Email:
${cleanedText}`,
  );
  const code = response.trim();
  if (!code || code.toLowerCase() === 'none') return null;
  if (!/^\d{4,8}$/.test(code)) return null;
  if (isObviouslyInvalid(code)) return null;
  return code;
}

export function extractMfaCode(text: string): string | null {
  // Try contextual match first — avoids matching SMS shortcodes or phone numbers
  // that appear earlier in the raw email source (e.g. "From: 864674").
  const contextual = text.match(
    /(?:security code|verification code|one.time.{0,6}code|otp|passcode)\D{0,10}(\d{4,8})/i,
  );
  if (contextual && !isObviouslyInvalid(contextual[1])) return contextual[1];
  const fallback = text.match(/\b(\d{6})\b/);
  if (fallback && !isObviouslyInvalid(fallback[1])) return fallback[1];
  return null;
}

async function searchForCode(
  client: ImapFlow,
  since: Date,
  model: string,
  seenUids: Set<number>,
  onEmailChecked?: (info: EmailInfo) => void,
): Promise<string | null> {
  // IMAP SINCE is day-granular; we filter by exact internalDate after fetching
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const uids = await client.search({ since: today }, { uid: true });
  if (!uids || uids.length === 0) return null;

  const range = uids.slice(-10).join(',');
  for await (const msg of client.fetch(
    range, { internalDate: true, envelope: true, source: true }, { uid: true },
  )) {
    if (!msg.internalDate || !msg.source) continue;
    if (seenUids.has(msg.uid)) continue;
    seenUids.add(msg.uid);

    const internalDate = new Date(msg.internalDate);
    const withinWindow = internalDate >= since;
    const shouldExtract = onEmailChecked || withinWindow;

    let extractedCode: string | null = null;
    if (shouldExtract) {
      const rawSource = msg.source.toString();
      const parsed = await simpleParser(rawSource);
      const textContent = parsed.text || '';
      const cleaned = textContent.replace(/\s+/g, ' ').trim().slice(0, 8000);

      // Try regex first to save AI API costs, fall back to AI extractor.
      extractedCode = extractMfaCode(cleaned) ?? await extractMfaCodeAI(cleaned, model);
    }

    if (onEmailChecked) {
      const fromAddr = msg.envelope?.from?.[0];
      const sender = fromAddr?.address ?? (fromAddr?.name || 'unknown');
      onEmailChecked({
        sender,
        subject: msg.envelope?.subject ?? '(no subject)',
        date: internalDate,
        extractedCode,
      });
    }

    if (withinWindow && extractedCode) return extractedCode;
  }

  return null;
}
