import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { convert as htmlToText } from 'html-to-text';
import { keychainLoad } from './keychain';
import { loadConfig } from './config';
import { callForText } from './agent/model_providers';
import type { ModelOptions } from './agent/model_providers/types';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 60000;


// since is the login start time — only accept emails that arrived after login began,
// so codes from a previous session are never mistakenly reused.
// verbose prints per-email subject, sender, and extraction results; also disables poll looping.
export async function fetchMfaCode(
  since: Date,
  model: string,
  verbose: boolean,
  modelOptions: ModelOptions,
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

  const deadline = verbose ? 0 : Date.now() + POLL_TIMEOUT_MS;

  console.log('    ⏳ Checking Gmail for MFA code...');

  try {
    await client.connect();
    const lock = await client.getMailboxLock('[Gmail]/All Mail');

    try {
      let attempt = 0;
      const seenUids = new Set<number>();
      do {
        // NOOP flushes pending server notifications so new messages appear in SEARCH
        await client.noop();
        const code = await searchForCode(
          client, since, model, modelOptions, seenUids, verbose,
        );
        if (code) return code;
        if (verbose) break;
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

const VALID_CODE_RE = /^\d{4,8}$/;
const ALL_SAME_DIGIT_RE = /^(\d)\1+$/;

async function extractMfaCodeAI(
  cleanedText: string,
  model: string,
  modelOptions: ModelOptions,
): Promise<{ code: string | null; warning: string | null }> {
  try {
    const response = await callForText(
      model,
      `Extract the MFA or verification code from this email. Reply with ONLY the numeric code digits.
If there is no verification code, reply with exactly: none

Email:
${cleanedText}`,
      20,
      modelOptions,
    );
    const code = response.trim();
    if (!code || code.toLowerCase() === 'none') return { code: null, warning: null };
    if (!VALID_CODE_RE.test(code)) {
      return { code: null, warning: `AI returned unexpected MFA code format: "${code}"` };
    }
    return { code, warning: null };
  } catch (err) {
    return {
      code: null,
      warning: `AI MFA extraction failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}

export function extractMfaCode(text: string): string | null {
  const patterns = [
    // Contextual: code digits preceded by a keyword — avoids phone numbers and tracking IDs
    /(?:security code|verification code|one.time.{0,6}code|otp|passcode)\D{0,10}(\d{4,8})/gi,
    // Fallback: any standalone 6-digit number
    /\b(\d{6})\b/g,
  ];
  for (const pattern of patterns) {
    const codes = Array.from(new Set(
      Array.from(text.matchAll(pattern)).map(m => m[1]).filter(c => !ALL_SAME_DIGIT_RE.test(c)),
    ));
    if (codes.length === 1) return codes[0];
    if (codes.length > 1) return null; // ambiguous — let AI handle it
  }
  return null;
}

async function searchForCode(
  client: ImapFlow,
  since: Date,
  model: string,
  modelOptions: ModelOptions,
  seenUids: Set<number>,
  // When true, prints per-email subject/sender/extraction results. Also disables poll looping.
  verbose: boolean,
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
    const ageMins = Math.round((Date.now() - internalDate.getTime()) / 60000);
    const fromAddr = msg.envelope?.from?.[0];
    const sender = fromAddr?.address ?? (fromAddr?.name || 'unknown');
    const subject = msg.envelope?.subject ?? '(no subject)';

    const isWithinWindow = internalDate >= since;

    if (!isWithinWindow) continue;

    if (verbose) {
      const ago = ageMins < 1 ? '<1m ago' : `${ageMins}m ago`;
      console.log(`  ✉️  ${subject} (${ago})`);
      console.log(`     👤 from: ${sender}`);
    } else {
      console.log(`    ✉️ "${subject}" from ${sender} (${ageMins}m ago)`);
    }

    const rawSource = msg.source.toString();
    const parsed = await simpleParser(rawSource);
    // Prefer plain text; fall back to HTML converted to text for HTML-only emails.
    const textContent = parsed.text
      ?? (parsed.html ? htmlToText(parsed.html, { wordwrap: false }) : '');
    const cleaned = textContent.replace(/\s+/g, ' ').trim().slice(0, 8000);

    // Try regex first to save AI API costs.
    let extractedCode = extractMfaCode(cleaned);
    let aiElapsedSecs: string | null = null;
    let aiWarning: string | null = null;
    if (extractedCode === null) {
      const aiStart = Date.now();
      ({ code: extractedCode, warning: aiWarning } = await extractMfaCodeAI(
        cleaned, model, modelOptions,
      ));
      aiElapsedSecs = ((Date.now() - aiStart) / 1000).toFixed(1);
    }

    if (aiWarning) console.warn(`     ⚠️  ${aiWarning}`);
    if (aiElapsedSecs) console.log(`     ✅ processed by ${model} in ${aiElapsedSecs}s`);
    if (verbose) {
      console.log(extractedCode ? `     ✅ MFA code found: ${extractedCode}` : '     ❌ no code found');
    } else if (!extractedCode) {
      console.log('     ❌ no code found');
    }

    if (isWithinWindow && extractedCode) return extractedCode;
  }

  return null;
}
