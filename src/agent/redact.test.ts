import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('replaces a sensitive value with [REDACTED]', () => {
    expect(redact('username: alice, password: hunter2', ['alice', 'hunter2']))
      .toBe('username: [REDACTED], password: [REDACTED]');
  });

  it('replaces longer values before shorter ones to avoid partial matches', () => {
    // 'secret123' contains 'secret' — the longer value must be replaced first
    // so we don't end up with '[REDACTED]123' instead of '[REDACTED]'
    expect(redact('token: secret123', ['secret', 'secret123']))
      .toBe('token: [REDACTED]');
  });
});
