import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('replaces each sensitive value with its label', () => {
    expect(redact('username: alice, password: hunter2', [
      { value: 'alice', label: '[USERNAME_REDACTED]' },
      { value: 'hunter2', label: '[PASSWORD_REDACTED]' },
    ])).toBe('username: [USERNAME_REDACTED], password: [PASSWORD_REDACTED]');
  });

  it('replaces longer values before shorter ones to avoid partial matches', () => {
    // 'secret123' contains 'secret' — the longer value must be replaced first
    // so we don't end up with '[SECRET_REDACTED]123' instead of '[TOKEN_REDACTED]'
    expect(redact('token: secret123', [
      { value: 'secret', label: '[SECRET_REDACTED]' },
      { value: 'secret123', label: '[TOKEN_REDACTED]' },
    ])).toBe('token: [TOKEN_REDACTED]');
  });
});
