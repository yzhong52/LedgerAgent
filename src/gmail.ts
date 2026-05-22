import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { keychainLoad } from './keychain';
import { loadConfig } from './config';
import { callForText } from './agent/model_providers';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 60000;

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
  model: string,
  onEmailChecked?: (info: EmailInfo) => void,
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
  return code;
}

export function extractMfaCode(text: string): string | null {
  const getUniqueValidCodes = (regex: RegExp): string[] => {
    const matches = Array.from(text.matchAll(regex));
    const codes = matches.map(m => m[1]);
    return Array.from(new Set(codes)); // Only keep unique codes
  };

  // Try contextual match first (global flag added)
  const contextual = getUniqueValidCodes(
    /(?:security code|verification code|one.time.{0,6}code|otp|passcode)\D{0,10}(\d{4,8})/gi,
  );
  // If exactly one unique code is found, it's safe to use.
  if (contextual.length === 1) return contextual[0];
  // If it's ambiguous (> 1 unique valid code), return null to fall back to the AI.
  if (contextual.length > 1) return null;

  // Fallback: any 6-digit numbers (global flag added)
  const fallback = getUniqueValidCodes(/\b(\d{6})\b/g);
  if (fallback.length === 1) return fallback[0];
  // If ambiguous, let AI handle it.
  if (fallback.length > 1) return null;

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
  const fetchOptions = {
    internalDate: true,
    envelope: true,
    source: true,
  };
  
  const messages = client.fetch(range, fetchOptions, { uid: true });
  for await (const msg of messages) {
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
