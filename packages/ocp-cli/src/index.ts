#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { OcpClient, OcpClientError, createCorrelationId } from '@ocp-catalog/ocp-client';
import { catalogManifestSchema, catalogQueryRequestSchema, resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import { doctorOcpSkill, installOcpSkill, uninstallOcpSkill, type SkillTarget } from './skill-installer';

const args = process.argv.slice(2);

try {
  const result = await run(args);
  if (result !== undefined) printJson(result);
} catch (error) {
  const payload = error instanceof OcpClientError
    ? { error: { code: 'ocp_client_error', message: error.message, details: error.details } }
    : { error: { code: 'cli_error', message: error instanceof Error ? error.message : String(error) } };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

async function run(argv: string[]) {
  const [domain, command, ...rest] = argv;
  if (!domain || domain === 'help' || domain === '--help') return help();

  if (domain === 'setup') {
    const flags = parseFlags([command, ...rest].filter((item): item is string => !!item));
    return installOcpSkill({
      target: skillTargetFromFlags(flags),
      dryRun: booleanFlag(flags, 'dry-run', false),
      force: booleanFlag(flags, 'force', false),
      sourceDir: stringFlag(flags, 'source-dir'),
    });
  }

  if (domain === 'skill' && (command === 'install' || command === 'update')) {
    const flags = parseFlags(rest);
    return installOcpSkill({
      target: skillTargetFromFlags(flags),
      dryRun: booleanFlag(flags, 'dry-run', false),
      force: booleanFlag(flags, 'force', false),
      sourceDir: stringFlag(flags, 'source-dir'),
    });
  }

  if (domain === 'skill' && command === 'uninstall') {
    const flags = parseFlags(rest);
    return uninstallOcpSkill({
      target: skillTargetFromFlags(flags),
      dryRun: booleanFlag(flags, 'dry-run', false),
      force: booleanFlag(flags, 'force', false),
    });
  }

  if (domain === 'skill' && command === 'doctor') {
    const flags = parseFlags(rest);
    return doctorOcpSkill(skillTargetFromFlags(flags));
  }

  if (domain === 'update') {
    const flags = parseFlags([command, ...rest].filter((item): item is string => !!item));
    return updateOcpCliAndSkill({
      manager: stringFlag(flags, 'manager', 'bun'),
      dryRun: booleanFlag(flags, 'dry-run', false),
      target: skillTargetFromFlags(flags),
    });
  }

  const flags = parseFlags(rest);
  const client = new OcpClient({
    timeoutMs: numberFlag(flags, 'timeout-ms', 10_000),
    userAgent: stringFlag(flags, 'user-agent', 'ocp-cli/0.1.0'),
    apiKey: stringFlag(flags, 'api-key'),
    correlationId: stringFlag(flags, 'correlation-id', createCorrelationId('cli')),
  });

  if (domain === 'registration' && command === 'discover') {
    const url = flags.positionals[0] ?? requiredFlag(flags, 'url');
    return client.discoverRegistration(url);
  }

  if (domain === 'registration' && command === 'search') {
    const registrationUrl = requiredFlag(flags, 'registration-url');
    return client.searchCatalogs(registrationUrl, {
      ocp_version: '1.0',
      kind: 'CatalogSearchRequest',
      query: stringFlag(flags, 'query') ?? '',
      limit: numberFlag(flags, 'limit', 20),
      explain: booleanFlag(flags, 'explain', true),
      filters: jsonFlag(flags, 'filters', {}),
    });
  }

  if (domain === 'registration' && command === 'resolve') {
    return client.resolveCatalogRoute(requiredFlag(flags, 'registration-url'), requiredFlag(flags, 'catalog-id'));
  }

  if (domain === 'catalog' && command === 'inspect') {
    const manifestUrl = flags.positionals[0] ?? requiredFlag(flags, 'manifest-url');
    return client.inspectCatalog(manifestUrl);
  }

  if (domain === 'catalog' && command === 'query') {
    const request = catalogQueryRequestSchema.parse({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      query_pack: requiredFlag(flags, 'query-pack'),
      query: stringFlag(flags, 'query') ?? '',
      filters: jsonFlag(flags, 'filters', {}),
      limit: numberFlag(flags, 'limit', 20),
      offset: numberFlag(flags, 'offset', 0),
      explain: booleanFlag(flags, 'explain', true),
    });
    return client.queryCatalog(requiredFlag(flags, 'query-url'), request);
  }

  if (domain === 'catalog' && command === 'resolve') {
    const request = resolveRequestSchema.parse({
      ocp_version: '1.0',
      kind: 'ResolveRequest',
      entry_id: requiredFlag(flags, 'entry-id'),
      purpose: stringFlag(flags, 'purpose') ?? 'view',
    });
    return client.resolveCatalogEntry(requiredFlag(flags, 'resolve-url'), request);
  }

  if (domain === 'validate' && command === 'manifest') {
    const target = flags.positionals[0] ?? requiredFlag(flags, 'input');
    const payload = target.startsWith('http://') || target.startsWith('https://')
      ? await client.inspectCatalog(target)
      : JSON.parse(await readFile(target, 'utf8'));
    return {
      ok: true,
      manifest: catalogManifestSchema.parse(payload),
    };
  }

  if (domain === 'events' && command === 'tail') {
    return client.listActivityEvents(requiredFlag(flags, 'activity-url'), numberFlag(flags, 'limit', 50));
  }

  throw new Error(`Unknown command: ${[domain, command].filter(Boolean).join(' ')}`);
}

function help() {
  return {
    usage: [
      'ocp setup [--target auto|codex|agents|both|<skills-dir>] [--dry-run]',
      'ocp update [--manager bun|npm] [--target auto|codex|agents|both|<skills-dir>] [--dry-run]',
      'ocp skill install [--target auto|codex|agents|both|<skills-dir>] [--force] [--dry-run]',
      'ocp skill install [--agent codex|agents|all] [--scope user|project] [--dir <skills-dir>] [--force]',
      'ocp skill update [--target auto|codex|agents|both|<skills-dir>] [--force] [--dry-run]',
      'ocp skill uninstall [--target auto|codex|agents|both|<skills-dir>] [--force] [--dry-run]',
      'ocp skill doctor [--target auto|codex|agents|both|<skills-dir>]',
      'ocp registration discover <discovery-url>',
      'ocp registration search --registration-url <url> [--query <text>]',
      'ocp registration resolve --registration-url <url> --catalog-id <id>',
      'ocp catalog inspect <manifest-url>',
      'ocp catalog query --query-url <url> --query-pack <id> [--query <text>]',
      'ocp catalog resolve --resolve-url <url> --entry-id <id>',
      'ocp validate manifest <file-or-url>',
      'ocp events tail --activity-url <url>',
    ],
  };
}

function updateOcpCliAndSkill(options: { manager?: string; dryRun: boolean; target: SkillTarget }) {
  const manager = options.manager ?? 'bun';
  const installCommand = manager === 'npm'
    ? ['npm', 'install', '-g', '@ocp-catalog/ocp-cli@latest']
    : ['bun', 'install', '-g', '@ocp-catalog/ocp-cli@latest'];
  const skillCommand = ['ocp', 'skill', 'update', '--target', String(options.target)];

  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      commands: [installCommand, skillCommand],
      note: 'update installs the latest CLI package, then runs the updated ocp binary to refresh the local skill',
    };
  }

  runCommand(installCommand);
  runCommand(skillCommand);

  return {
    ok: true,
    dry_run: false,
    commands: [installCommand, skillCommand],
  };
}

function skillTargetFromFlags(flags: ParsedFlags): SkillTarget {
  const explicitDir = stringFlag(flags, 'dir');
  if (explicitDir) return explicitDir;

  const explicitTarget = stringFlag(flags, 'target');
  if (explicitTarget) return explicitTarget;

  const scope = stringFlag(flags, 'scope', 'user');
  if (scope === 'project') return pathJoin(process.cwd(), '.agents', 'skills');

  const agent = stringFlag(flags, 'agent');
  if (agent === 'all') return 'both';
  if (agent === 'codex' || agent === 'agents') return agent;

  return 'auto';
}

function pathJoin(...parts: string[]) {
  return parts.join(process.platform === 'win32' ? '\\' : '/');
}

function runCommand(command: string[]) {
  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`${command.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
}

type ParsedFlags = {
  positionals: string[];
  values: Map<string, string | boolean>;
};

function parseFlags(argv: string[]): ParsedFlags {
  const values = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      positionals.push(item);
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values.set(key, true);
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  return { positionals, values };
}

function requiredFlag(flags: ParsedFlags, key: string) {
  const value = stringFlag(flags, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function stringFlag(flags: ParsedFlags, key: string, fallback?: string) {
  const value = flags.values.get(key);
  return typeof value === 'string' ? value : fallback;
}

function numberFlag(flags: ParsedFlags, key: string, fallback: number) {
  const value = stringFlag(flags, key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number`);
  return parsed;
}

function booleanFlag(flags: ParsedFlags, key: string, fallback: boolean) {
  const value = flags.values.get(key);
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

function jsonFlag<T>(flags: ParsedFlags, key: string, fallback: T): T {
  const value = stringFlag(flags, key);
  return value ? JSON.parse(value) as T : fallback;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
