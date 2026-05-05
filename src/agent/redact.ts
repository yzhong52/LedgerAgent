// Replaces every occurrence of each sensitive value in text with [REDACTED].
// Longer values are replaced first so that a value which is a substring of
// another doesn't partially match before the longer one has a chance to.
export function redact(text: string, sensitiveValues: string[]): string {
  const values = sensitiveValues
    .filter(v => v.length > 0)
    .sort((a, b) => b.length - a.length);
  return values.reduce((out, value) => out.replaceAll(value, '[REDACTED]'), text);
}
