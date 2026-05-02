import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DATA_DIR } from '../db';
import { ACCOUNT_TOOL, LOGIN_TOOL, TRANSACTION_TOOL } from './tools';

const CACHE_VERSION = 1;
const VERBOSE = process.env.VERBOSE === '1' || process.env.DEBUG === '1';

/** SHA-256 of a normalized snapshot, truncated to 16 hex characters. */
type Fingerprint = string;

export interface CachedAction {
  /** Tool name, e.g. "click", "fill", "snapshot". */
  name: string;
  /** Tool input as received from the Anthropic API. Keys are parameter names
   *  and values are strings or booleans — e.g. `{ role: "button", name: "Log in" }`
   *  for `click`. Typed as `unknown` rather than `any` to require an explicit cast before use. */
  input: Record<string, unknown>;
}

interface CacheData {
  /** Incremented when the file format changes; mismatches cause the file to be discarded. */
  version: number;
  steps: Record<Fingerprint, CachedAction>;
  /** ISO 8601 timestamp of the last write. Informational only — never read back. */
  updatedAt: string;
}

// Strip dynamic values that change between runs but don't affect page structure.
// Order matters: more specific patterns first.
const NORMALIZE_RULES: Array<[RegExp, string]> = [
  // Dollar amounts  e.g. "$1,234.56"
  [/\$[\d,]+(?:\.\d+)?/g, '$_'],
  // Masked account numbers  e.g. "****1234", "XXXX-1234"
  [/[Xx*]{2,}[\s-]?\d+/g, 'ACCT'],
  // Large comma-separated numbers  e.g. "1,234,567.89"
  [/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, '_NUM_'],
  // Decimal numbers with exactly 2 places (financial amounts)
  [/\b\d+\.\d{2}\b/g, '_NUM_'],
  // Percentages  e.g. "3.5%"
  [/\b\d+(?:\.\d+)?%/g, '_%'],
  // ISO dates  e.g. "2024-01-15"
  [/\d{4}-\d{2}-\d{2}/g, '_DATE_'],
  // Month Day, Year  e.g. "January 15, 2024" or "Jan 15 2024"
  [/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember))\b\.?\s+\d{1,2},?\s+\d{4}/gi, '_DATE_'],
  // Numeric dates  e.g. "01/15/2024"
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '_DATE_'],
  // Times  e.g. "3:45 PM", "15:30:00"
  [/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\b/gi, '_TIME_'],
];

// Tool inputs containing these field names hold credential values — don't cache them.
const SENSITIVE_FIELD_RE = /password|passcode|pin|secret|cvv|ssn/i;

// Tools whose inputs embed live session data that must not be cached verbatim.
const NON_CACHEABLE_TOOLS = new Set<string>([
  ACCOUNT_TOOL.REPORT_ACCOUNTS,
  TRANSACTION_TOOL.REPORT_TRANSACTIONS,
]);

export function normalizeSnapshot(snapshot: string): string {
  let s = snapshot;
  for (const [re, sub] of NORMALIZE_RULES) s = s.replace(re, sub);
  return s.replace(/\s+/g, ' ').trim();
}

function fp(snapshot: string): Fingerprint {
  // Truncate to 16 hex chars (64 bits). Collision probability among N keys is
  // ~N²/2⁶⁴ — negligible for the ~10–20 distinct pages a typical institution
  // has. The full 64-char SHA-256 would also work; this just keeps the JSON readable.
  return crypto.createHash('sha256').update(normalizeSnapshot(snapshot)).digest('hex').slice(0, 16);
}

/** Returns false for tools whose inputs contain live data that must not be persisted
 *  (e.g. password fields, report_accounts with current balances). */
function isCacheable(toolName: string, input: Record<string, unknown>): boolean {
  if (NON_CACHEABLE_TOOLS.has(toolName)) return false;
  if ((toolName === LOGIN_TOOL.FILL || toolName === LOGIN_TOOL.TYPE) && SENSITIVE_FIELD_RE.test(String(input.name))) return false;
  return true;
}

/** Persists a mapping of page-structure fingerprints to agent actions so that
 *  repeated runs against the same institution can skip Claude API calls for
 *  pages the agent has already seen. On a cache hit the stored action is
 *  replayed directly; on a miss or replay failure the agent falls back to
 *  Claude and updates the cache with whatever Claude does next. */
export class PageCache {
  private data: CacheData;
  private filePath: string;
  /** True when in-memory steps differ from what's on disk; flush() writes and clears it. */
  private dirty = false;
  // Fingerprints that produced a failed replay this run — don't retry them.
  private failedFps = new Set<Fingerprint>();

  constructor(data: CacheData, filePath: string) {
    this.data = data;
    this.filePath = filePath;
  }

  /** Look up the cached action for a snapshot. Returns null on a cache miss,
   *  or if the snapshot's fingerprint was previously marked as failed via
   *  `failSnapshot()` — in both cases the caller should fall back to Claude. */
  check(snapshot: string): CachedAction | null {
    const h = fp(snapshot);
    if (this.failedFps.has(h)) return null;
    return this.data.steps[h] ?? null;
  }

  /** Record what action Claude chose in response to a snapshot, so it can be
   *  replayed on the next run. No-ops for non-cacheable tools (e.g. password
   *  fills, report_accounts). Call this after every real Claude API response,
   *  not after replays. */
  record(snapshot: string, name: string, input: Record<string, unknown>): void {
    if (!isCacheable(name, input)) return;
    const h = fp(snapshot);
    const existing = this.data.steps[h];
    if (existing?.name === name && JSON.stringify(existing.input) === JSON.stringify(input)) return; // unchanged
    this.data.steps[h] = { name, input };
    this.data.updatedAt = new Date().toISOString();
    this.dirty = true;
  }

  // Mark a snapshot's cached action as bad for this run (replay failed).
  failSnapshot(snapshot: string): void {
    this.failedFps.add(fp(snapshot));
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
    this.dirty = false;
    if (VERBOSE) console.log(`💾 Page cache saved (${Object.keys(this.data.steps).length} entries)`);
  }
}

export async function loadPageCache(institution: string, task: string): Promise<PageCache> {
  const slug = institution.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filePath = path.join(DATA_DIR, 'page-cache', `${slug}-${task}.json`);

  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8')) as CacheData;
    if (raw.version !== CACHE_VERSION || typeof raw.steps !== 'object') {
      // Stale or corrupt — start fresh.
      return new PageCache({ version: CACHE_VERSION, steps: {}, updatedAt: new Date().toISOString() }, filePath);
    }
    const count = Object.keys(raw.steps).length;
    if (VERBOSE) console.log(`📂 Loaded page cache: ${count} ${count === 1 ? 'entry' : 'entries'}`);
    return new PageCache(raw, filePath);
  } catch {
    return new PageCache({ version: CACHE_VERSION, steps: {}, updatedAt: new Date().toISOString() }, filePath);
  }
}
