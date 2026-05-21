export interface SensitiveValue {
  value: string;
  label: string;
}

// Replaces every occurrence of each sensitive value in text with its label.
// Longer values are replaced first so that a value which is a substring of
// another doesn't partially match before the longer one has a chance to.
export function redact(text: string, sensitiveValues: SensitiveValue[]): string {
  const pairs = sensitiveValues
    .filter(v => v.value.length > 0)
    .sort((a, b) => b.value.length - a.value.length);
  return pairs.reduce((out, { value, label }) => out.replaceAll(value, label), text);
}
