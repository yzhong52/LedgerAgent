import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DATA_DIR } from './db';
import { MODEL } from './agent';
import { keychainLoadApiKey } from './keychain';

export interface ToolEvent {
  description: string;
  outcome: 'success' | 'error';
  error?: string;
}

type MemoryFile = Partial<Record<string, string>>;
const BAD_SUMMARY_PATTERNS = [
  /could you please share/i,
  /you haven't provided/i,
  /session (data|details).*(empty|weren't included)/i,
];
const PREFERRED_TASK_ORDER = ['login', 'accounts'];

function normalizeNotes(notes: string | undefined): string {
  let trimmed = notes?.trim() ?? '';
  if (!trimmed) return '';
  if (BAD_SUMMARY_PATTERNS.some(pattern => pattern.test(trimmed))) return '';
  // Strip a leading ## heading — the task name is already the section heading.
  trimmed = trimmed.replace(/^##[^\n]*\n+/, '').trim();
  return trimmed;
}

function memorySlug(institutionName: string): string {
  return institutionName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function markdownMemoryPath(institutionName: string): string {
  return path.join(DATA_DIR, 'memory', `${memorySlug(institutionName)}.md`);
}

function parseMarkdownMemory(content: string): MemoryFile {
  const file: MemoryFile = {};
  let currentTask = '';
  let buffer: string[] = [];

  const flush = () => {
    if (!currentTask) return;
    const notes = normalizeNotes(buffer.join('\n'));
    if (notes) file[currentTask] = notes;
  };

  for (const line of content.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      currentTask = heading[1].trim().toLowerCase();
      buffer = [];
      continue;
    }
    if (currentTask) buffer.push(line);
  }

  flush();
  return file;
}

function serializeMarkdownMemory(slug: string, file: MemoryFile): string {
  const orderedTasks = [
    ...PREFERRED_TASK_ORDER.filter(task => file[task]),
    ...Object.keys(file).filter(task => !PREFERRED_TASK_ORDER.includes(task)).sort(),
  ];
  const sections = orderedTasks
    .map(task => file[task] ? `## ${task}\n${file[task]}` : '')
    .filter(Boolean);

  if (sections.length === 0) return `# ${slug}\n`;
  return `# ${slug}\n\n${sections.join('\n\n')}\n`;
}

async function readMemoryFile(institutionName: string): Promise<MemoryFile> {
  try {
    return parseMarkdownMemory(await fs.readFile(markdownMemoryPath(institutionName), 'utf-8'));
  } catch {
    return {};
  }
}

export async function loadMemoryNotes(institutionName: string, task: string): Promise<string> {
  const file = await readMemoryFile(institutionName);
  return normalizeNotes(file[task]);
}

export async function saveMemoryNotes(
  institutionName: string, task: string, notes: string,
): Promise<void> {
  const normalized = normalizeNotes(notes);
  if (!normalized) return;
  const dir = path.join(DATA_DIR, 'memory');
  await fs.mkdir(dir, { recursive: true });
  const file = await readMemoryFile(institutionName);
  file[task] = normalized;
  await fs.writeFile(
    markdownMemoryPath(institutionName),
    serializeMarkdownMemory(memorySlug(institutionName), file),
  );
}

export function formatMemoryForPrompt(notes: string, task: string): string {
  if (!notes) return '';
  return `\nNotes from previous ${task} sessions for this institution:\n${notes}`;
}

export async function generateSessionNotes(
  events: ToolEvent[], taskContext: string,
): Promise<string> {
  if (events.length === 0) return '';

  const transcript = events
    .map(e => `- ${e.description}: ${e.outcome === 'error' ? `FAILED (${e.error})` : 'ok'}`)
    .join('\n');

  const client = new Anthropic({ apiKey: keychainLoadApiKey() ?? process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are reviewing a browser automation session for ${taskContext}. Here is the sequence of actions taken:\n\n${transcript}\n\nWrite 3-5 concise bullet points capturing:\n- Which selectors or tools worked well and should be tried first next time\n- Which failed and what succeeded instead\n- Any unusual flows or page structures encountered\n\nBe specific about element names and tools used. These notes will be injected into the next session's system prompt.\n\nDo not include a heading or title — start directly with the bullet points.`,
    }],
  });

  const block = response.content.find(b => b.type === 'text');
  return normalizeNotes(block?.text);
}
