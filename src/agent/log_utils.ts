import * as fs from 'fs/promises';
import { LOGS_DIR } from '../db';
import { BROWSER_TOOL, SUCCESS_TOOL } from './tools';

export const SEPARATOR = '─'.repeat(60);
export const VERBOSE = process.env.VERBOSE === '1';

const MAX_LOG_SESSIONS = 20;

function briefInput(input: Record<string, unknown>): string {
  if (input.role && input.name) return `${input.role} "${input.name}"`;
  if (input.ref && input.value) return `[ref=${input.ref}] "${input.value}"`;
  if (input.ref) return `[ref=${input.ref}]`;
  if (input.testId) return `#${input.testId}`;
  if (input.text) return `"${input.text}"`;
  if (input.selector) return `"${input.selector}"`;
  if (Array.isArray(input.transactions)) return `(${input.transactions.length} items)`;
  if (Array.isArray(input.accounts)) return `(${input.accounts.length} items)`;
  return '';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

function sessionTimestamp(folderName: string): string | null {
  const timestampFirst = folderName.match(/^(\d{4}-\d{2}-\d{2}_\d{6}(?:_\d{3})?)_/);
  if (timestampFirst) return timestampFirst[1];

  const legacyTimestampLast = folderName.match(/_(\d{4}-\d{2}-\d{2}_\d{6})$/);
  return legacyTimestampLast ? legacyTimestampLast[1] : null;
}

function slugifyLogName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'unknown_institution';
}

async function pruneLogSessions(): Promise<void> {
  const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true }).catch(() => []);
  const folders = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, timestamp: sessionTimestamp(e.name) }))
    .filter((e): e is { name: string; timestamp: string } => e.timestamp !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const { name } of folders.slice(MAX_LOG_SESSIONS)) {
    await fs.rm(`${LOGS_DIR}/${name}`, { recursive: true }).catch(() => {});
  }
}

export async function createSession(institutionName: string): Promise<string> {
  const institutionSlug = slugifyLogName(institutionName);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  const sessionDir = `${LOGS_DIR}/${date}_${time}_${milliseconds}_${institutionSlug}`;
  await fs.mkdir(sessionDir, { recursive: true });
  await pruneLogSessions();
  return sessionDir;
}

export function logSnapshot(snap: string, snapFile: string): void {
  if (VERBOSE) {
    const preview = snap.length > 240 ? snap.slice(0, 240) + '…' : snap;
    console.log(`📸 Snapshot:\n${preview}\nFull: ${snapFile}`);
  } else {
    console.log(`📸 Snapshot`);
  }
}

export function logToolUse(
  turn: number,
  maxTurns: number,
  name: string,
  input: Record<string, unknown>,
  redactSensitive: (text: string) => string,
  durationMs: number,
): void {
  const duration = ` (${formatDuration(durationMs)})`;
  if (name === SUCCESS_TOOL) {
    console.log(`🔄 ${turn + 1}/${maxTurns} 💬 Mission accomplished${duration}`);
  } else if (VERBOSE) {
    console.log(`🔄 ${turn + 1}/${maxTurns} 💬 ${name}${duration}`, redactSensitive(JSON.stringify(input)));
  } else {
    const brief = briefInput(input);
    console.log(`🔄 ${turn + 1}/${maxTurns} 💬 ${name}${brief ? ` ${brief}` : ''}${duration}`);
  }
}

export function logToolResult(name: string, output: string): void {
  const preview = output.length > 240 ? output.slice(0, 240) + '…' : output;
  if (name === BROWSER_TOOL.GET_INPUTS) {
    if (VERBOSE) console.log(`🔧 Inputs retrieved:\n${preview}`);
    else console.log(`🔧 Inputs retrieved`);
  } else {
    console.log(`🔧 ${preview}`);
  }
}

export function logToolError(err: unknown, output: string): void {
  if (VERBOSE) {
    const preview = output.length > 480 ? output.slice(0, 480) + '…' : output;
    // Playwright errors contain ANSI colour codes; '\x1b[0m' prevents colour bleed.
    console.log(`❌ ${preview}\x1b[0m`);
  } else {
    const errorType = err instanceof Error ? err.constructor.name : String(err);
    console.log(`❌ ${errorType}`);
  }
}
