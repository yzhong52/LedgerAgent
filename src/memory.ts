import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DATA_DIR } from './db';
import { MODEL } from './agent';

export interface ToolEvent {
  description: string;
  outcome: 'success' | 'error';
  error?: string;
}

type MemoryFile = Partial<Record<string, string>>;

function memoryPath(institutionName: string): string {
  const slug = institutionName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return path.join(DATA_DIR, 'memory', `${slug}.json`);
}

async function readMemoryFile(institutionName: string): Promise<MemoryFile> {
  try {
    return JSON.parse(await fs.readFile(memoryPath(institutionName), 'utf-8'));
  } catch {
    return {};
  }
}

export async function loadMemoryNotes(institutionName: string, task: string): Promise<string> {
  const file = await readMemoryFile(institutionName);
  return file[task] ?? '';
}

export async function saveMemoryNotes(institutionName: string, task: string, notes: string): Promise<void> {
  if (!notes) return;
  const dir = path.join(DATA_DIR, 'memory');
  await fs.mkdir(dir, { recursive: true });
  const file = await readMemoryFile(institutionName);
  file[task] = notes;
  await fs.writeFile(memoryPath(institutionName), JSON.stringify(file, null, 2) + '\n');
}

export function formatMemoryForPrompt(notes: string, task: string): string {
  if (!notes) return '';
  return `\nNotes from previous ${task} sessions for this institution:\n${notes}`;
}

export async function generateSessionNotes(events: ToolEvent[], taskContext: string): Promise<string> {
  const transcript = events
    .map(e => `- ${e.description}: ${e.outcome === 'error' ? `FAILED (${e.error})` : 'ok'}`)
    .join('\n');

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are reviewing a browser automation session for ${taskContext}. Here is the sequence of actions taken:\n\n${transcript}\n\nWrite 3-5 concise bullet points capturing:\n- Which selectors or tools worked well and should be tried first next time\n- Which failed and what succeeded instead\n- Any unusual flows or page structures encountered\n\nBe specific about element names and tools used. These notes will be injected into the next session's system prompt.`,
    }],
  });

  const block = response.content.find(b => b.type === 'text');
  return block ? block.text.trim() : '';
}
