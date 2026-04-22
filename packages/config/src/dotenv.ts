import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function readDotEnv(startDir = process.cwd()) {
  const file = findUp('.env', startDir);
  if (!file) return {};

  const values: Record<string, string> = {};
  const content = readFileSync(file, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = unquote(rawValue);
  }

  return values;
}

function findUp(filename: string, startDir: string) {
  let current = resolve(startDir);

  while (true) {
    const candidate = resolve(current, filename);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function unquote(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
