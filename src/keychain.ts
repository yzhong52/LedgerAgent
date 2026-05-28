import { spawnSync } from 'child_process';

const SERVICE = 'ledgeragent';

// Account key includes the institution name to avoid collisions when the
// same email is used at multiple institutions.
function accountKey(name: string, email: string): string {
  return `${name.toLowerCase()}:${email}`;
}

export function keychainSave(name: string, email: string, password: string): void {
  const result = spawnSync('security', [
    'add-generic-password', '-U',
    '-s', SERVICE,
    '-a', accountKey(name, email),
    '-w', password,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr.toString().trim());
  }
}

export function keychainLoad(name: string, email: string): string | null {
  const result = spawnSync('security', [
    'find-generic-password',
    '-s', SERVICE,
    '-a', accountKey(name, email),
    '-w',
  ]);
  if (result.status !== 0) return null;
  return result.stdout.toString().trim();
}

const ANTHROPIC_ACCOUNT = 'anthropic-api-key';
const OPENROUTER_ACCOUNT = 'openrouter-api-key';

export function keychainSaveApiKey(key: string): void {
  const result = spawnSync('security', [
    'add-generic-password', '-U',
    '-s', SERVICE,
    '-a', ANTHROPIC_ACCOUNT,
    '-w', key,
  ]);
  if (result.status !== 0) throw new Error(result.stderr.toString().trim());
}

export function keychainLoadApiKey(): string | null {
  const result = spawnSync('security', [
    'find-generic-password',
    '-s', SERVICE,
    '-a', ANTHROPIC_ACCOUNT,
    '-w',
  ]);
  if (result.status !== 0) return null;
  return result.stdout.toString().trim();
}

export function keychainSaveOpenRouterApiKey(key: string): void {
  const result = spawnSync('security', [
    'add-generic-password', '-U',
    '-s', SERVICE,
    '-a', OPENROUTER_ACCOUNT,
    '-w', key,
  ]);
  if (result.status !== 0) throw new Error(result.stderr.toString().trim());
}

export function keychainLoadOpenRouterApiKey(): string | null {
  const result = spawnSync('security', [
    'find-generic-password',
    '-s', SERVICE,
    '-a', OPENROUTER_ACCOUNT,
    '-w',
  ]);
  if (result.status !== 0) return null;
  return result.stdout.toString().trim();
}
