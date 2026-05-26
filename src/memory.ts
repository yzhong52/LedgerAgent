import * as fs from 'fs/promises';
import * as path from 'path';
import { DATA_DIR } from './db';
import { callForText } from './agent/model_providers';
import type { ModelOptions } from './agent/model_providers/types';

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
  // Strip ARIA ref IDs — they change every session and are meaningless across runs.
  trimmed = trimmed.replace(/\[ref=e\d+\]/g, '').replace(/\bref=e\d+\b/g, '').trim();
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
  return (
    `\nNotes from previous ${task} sessions for this institution (treat as hints, not rules —` +
    ` sites change; always trust what you see on the current page over these notes):\n${notes}`
  );
}


export async function generateSessionNotes(
  events: ToolEvent[], taskContext: string, model: string, previousNotes: string = '',
  modelOptions: ModelOptions = {},
): Promise<string> {
  if (events.length === 0) return '';

  const transcript = events
    .map(e => `- ${e.description}: ${e.outcome === 'error' ? `FAILED (${e.error})` : 'ok'}`)
    .join('\n');

  const previousSection = previousNotes
    ? `Previous notes (may contain errors — correct anything this session disproves):\n${previousNotes}\n\n`
    : '';

  const text = await callForText(
    model,
    `You are reviewing a browser automation session for ${taskContext}.

${previousSection}This session's actions:
${transcript}

Create or update the notes with 3-5 concise bullet points.
Keep what is still accurate, correct anything this session proves wrong, and add new findings.
Be specific about Playwright tool names, data-testid values, ARIA roles, and element names.
Do NOT include ARIA ref IDs (e.g. [ref=e42]) — they change every session and are useless in notes.
Do not include a heading — start directly with the bullet points.`,
    undefined,
    modelOptions,
  );

  return normalizeNotes(text);
}
