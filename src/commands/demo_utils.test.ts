import { describe, it, expect } from 'vitest';
import { randomBalance, randomizeDigits } from './demo_utils';

describe('randomBalance', () => {
  it('returns a dollar-formatted string', () => {
    expect(randomBalance()).toMatch(/^\$[\d,]+\.\d{2}$/);
  });
});

describe('randomizeDigits', () => {
  it('replaces digits with random digits of the same length', () => {
    const result = randomizeDigits('Account ****1234');
    expect(result).toMatch(/^Account \*\*\*\*\d{4}$/);
  });

  it('leaves non-digit characters unchanged', () => {
    const result = randomizeDigits('No numbers here!');
    expect(result).toBe('No numbers here!');
  });
});
