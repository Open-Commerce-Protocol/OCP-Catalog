import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cliPath = path.resolve(import.meta.dir, 'index.ts');
const tmpRoot = path.join(tmpdir(), 'ocp-cli-help-test');

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function runCli(...args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve(import.meta.dir, '..', '..', '..'),
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function runCliRaw(...args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve(import.meta.dir, '..', '..', '..'),
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ? JSON.parse(result.stdout) : undefined,
    stderr: result.stderr ? JSON.parse(result.stderr) : undefined,
  };
}

function writeManifestFile() {
  mkdirSync(tmpRoot, { recursive: true });
  const manifestPath = path.join(tmpRoot, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: 'manifest_1',
    catalog_id: 'cat_test',
    catalog_name: 'Test Catalog',
    endpoints: {
      query: { url: 'https://catalog.example.test/ocp/query', method: 'POST' },
      resolve: { url: 'https://catalog.example.test/ocp/resolve', method: 'POST' },
    },
    query_capabilities: [
      {
        capability_id: 'commerce.search',
        query_packs: [
          { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword', 'hybrid'], metadata: {} },
        ],
        searchable_field_refs: [],
        filterable_field_refs: [],
        sortable_field_refs: [],
        input_fields: [
          { name: 'filters.category', type: 'string' },
        ],
        supports_explain: true,
        supports_resolve: true,
        metadata: {},
      },
    ],
    object_contracts: [
      {
        required_fields: ['ocp.commerce.product.core.v1#/title'],
        optional_fields: [],
        additional_fields_policy: 'allow',
      },
    ],
  }));
  return manifestPath;
}

describe('CLI help', () => {
  test('describes every command with intent, options, and examples', () => {
    const help = runCli('--help');

    expect(help.overview).toContain('OCP Catalog');
    expect(help.workflow).toEqual([
      'Discover a Registration node',
      'Search or resolve a Catalog route',
      'Inspect the Catalog manifest',
      'Query with a manifest-declared query pack',
      'Resolve a selected entry when details or actions are needed',
    ]);

    expect(help.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'ocp registration discover <discovery-url>',
          summary: expect.stringContaining('Registration'),
          description: expect.stringContaining('discovery document'),
          options: expect.arrayContaining([
            expect.objectContaining({
              name: '--timeout-ms',
              description: expect.stringContaining('request timeout'),
            }),
          ]),
          examples: expect.arrayContaining([
            expect.stringContaining('ocp registration discover'),
          ]),
        }),
        expect.objectContaining({
          command: 'ocp catalog query --query-url <url> [--query-pack <id>] [--query <text>]',
          summary: expect.stringContaining('Search'),
          description: expect.stringContaining('manifest-declared query pack'),
          options: expect.arrayContaining([
            expect.objectContaining({
              name: '--filters',
              description: expect.stringContaining('JSON object'),
            }),
          ]),
        }),
        expect.objectContaining({
          command: 'ocp skill doctor [--target auto|codex|agents|both|<skills-dir>]',
          summary: expect.stringContaining('Check'),
          description: expect.stringContaining('installed skill'),
        }),
        expect.objectContaining({
          command: 'ocp events tail --activity-url <url>',
          summary: expect.stringContaining('Read'),
          description: expect.stringContaining('public Activity API'),
        }),
      ]),
    );

    for (const command of help.commands) {
      expect(command.summary).toBeString();
      expect(command.description).toBeString();
      expect(command.options.length).toBeGreaterThan(0);
      expect(command.examples.length).toBeGreaterThan(0);
    }
  });

  test('returns focused help for domains and individual commands', () => {
    const registration = runCli('registration', '--help');

    expect(registration.domain).toBe('registration');
    expect(registration.description).toContain('do not search products');
    expect(registration.commands.map((command: { action?: string }) => command.action)).toEqual([
      'discover',
      'search',
      'resolve',
    ]);

    const catalogQuery = runCli('catalog', 'query', '--help');

    expect(catalogQuery.command).toBe('ocp catalog query --query-url <url> [--query-pack <id>] [--query <text>]');
    expect(catalogQuery.description).toContain('manifest-declared query pack');
    expect(catalogQuery.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '--query-pack',
          description: expect.stringContaining('Optional'),
        }),
      ]),
    );
  });

  test('validates a query against a manifest before sending it', () => {
    const manifestPath = writeManifestFile();

    const success = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--query',
      'running shoes',
      '--filters',
      '{"category":"shoes"}',
    );

    expect(success.status).toBe(0);
    expect(success.stdout).toMatchObject({
      ok: true,
      request: {
        query_pack: 'ocp.query.keyword.v1',
      },
      policy_summary: {
        selected_query_pack: 'ocp.query.keyword.v1',
        accepted_filters: ['category'],
      },
    });

    const failure = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--query-pack',
      'ocp.query.semantic.v1',
      '--filters',
      '{"brand":"Acme"}',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        message: expect.stringContaining('unsupported query_pack'),
        details: {
          code: 'invalid_query_pack',
          supported_query_packs: ['ocp.query.keyword.v1'],
        },
      },
    });
  });

  test('catalog query uses manifest validation before network send when manifest is provided', () => {
    const manifestPath = writeManifestFile();

    const failure = runCliRaw(
      'catalog',
      'query',
      '--manifest',
      manifestPath,
      '--query-url',
      'https://catalog.example.test/ocp/query',
      '--query-pack',
      'ocp.query.semantic.v1',
      '--query',
      'running shoes',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        message: expect.stringContaining('unsupported query_pack'),
        details: {
          code: 'invalid_query_pack',
          supported_query_packs: ['ocp.query.keyword.v1'],
        },
      },
    });
    expect(JSON.stringify(failure.stderr)).not.toContain('Failed to fetch');
  });

  test('catalog query rejects a query URL that does not match the provided manifest', () => {
    const manifestPath = writeManifestFile();

    const failure = runCliRaw(
      'catalog',
      'query',
      '--manifest',
      manifestPath,
      '--query-url',
      'https://other.example.test/ocp/query',
      '--query',
      'running shoes',
      '--filters',
      '{"category":"shoes"}',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'invalid_query_endpoint',
          received_query_url: 'https://other.example.test/ocp/query',
          manifest_query_url: 'https://catalog.example.test/ocp/query',
        },
      },
    });
  });

  test('normalizes protocol schema errors as validation feedback', () => {
    const manifestPath = writeManifestFile();

    const limitFailure = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--query',
      'running shoes',
      '--limit',
      '0',
    );

    expect(limitFailure.status).toBe(1);
    expect(limitFailure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'protocol_schema_error',
          correction: expect.stringContaining('protocol schema'),
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'limit',
              message: expect.any(String),
            }),
          ]),
        },
      },
    });

    const filterFailure = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--filters',
      '{"color":"blue"}',
    );

    expect(filterFailure.status).toBe(1);
    expect(filterFailure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'protocol_schema_error',
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'filters',
              code: 'unrecognized_keys',
            }),
          ]),
        },
      },
    });
  });
});
