import * as fs from 'fs/promises';
import * as path from 'path';
import { DATA_DIR } from './db';

interface SelectorFailure {
  tool: string;
  input: Record<string, unknown>;
  error: string;
}

export interface LoginMemory {
  failures: SelectorFailure[];
}

function memoryPath(institutionName: string): string {
  const slug = institutionName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return path.join(DATA_DIR, 'memory', `${slug}.json`);
}

export async function loadLoginMemory(institutionName: string): Promise<LoginMemory> {
  try {
    return JSON.parse(await fs.readFile(memoryPath(institutionName), 'utf-8'));
  } catch {
    return { failures: [] };
  }
}

export async function saveLoginMemory(institutionName: string, memory: LoginMemory): Promise<void> {
  if (memory.failures.length === 0) return;
  const dir = path.join(DATA_DIR, 'memory');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(memoryPath(institutionName), JSON.stringify(memory, null, 2) + '\n');
}

export function formatMemoryForPrompt(memory: LoginMemory): string {
  if (memory.failures.length === 0) return '';
  const lines = memory.failures.map(f => {
    const desc = f.input.role
      ? `${f.tool}(${f.input.role} "${f.input.name}")`
      : `${f.tool}(${JSON.stringify(f.input)})`;
    const reason = f.error.split('\n')[0].replace(/^error:\s*/i, '');
    return `- ${desc} previously failed: "${reason}". Try click_text, click_testid, or click_js instead.`;
  });
  return `\nLessons from previous sessions for this institution:\n${lines.join('\n')}`;
}
