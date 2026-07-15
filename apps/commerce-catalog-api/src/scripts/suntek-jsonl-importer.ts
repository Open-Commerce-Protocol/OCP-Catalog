import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { commercialObjectSchema, registrationResultSchema, type CommercialObject } from '@ocp-catalog/ocp-schema';
import { z } from 'zod';

const DEFAULT_PROVIDER_ID = 'suntek';
const DEFAULT_PROVIDER_NAME = '三态股份 / Suntek';
const DEFAULT_PROVIDER_DOMAIN = 'suntek.catalog.deeplumen.io';
const DEFAULT_PROVIDER_HOMEPAGE = 'https://suntek.catalog.deeplumen.io';
const DEFAULT_CONTACT_EMAIL = 'ops@deeplumen.io';
const DEFAULT_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 1000;

const nonEmptyString = z.string().trim().min(1);
const urlString = z.string().url();

export const suntekSourceProductSchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  description_html: z.string().optional(),
  price: z.object({
    amount: z.union([z.string(), z.number()]),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
  }).strict(),
  images: z.array(urlString).default([]),
  variants: z.array(z.object({
    sku: nonEmptyString,
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    price: z.union([z.string(), z.number()]).optional(),
    weight_grams: z.union([z.string(), z.number(), z.null()]).optional(),
  }).strict()).min(1),
  ai_summary: z.string().optional(),
  dimensions_cm: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
}).strict();

export type SuntekSourceProduct = z.infer<typeof suntekSourceProductSchema>;

export type SuntekImportOptions = {
  input: string;
  catalogUrl: string;
  catalogId: string;
  providerId: string;
  providerName: string;
  providerDomain: string;
  providerHomepage: string;
  contactEmail: string;
  batchId: string;
  chunkSize: number;
  apiKey?: string;
  dryRun: boolean;
};

export type SuntekImportSummary = {
  input: string;
  catalog_id: string;
  provider_id: string;
  registration_version?: number;
  batch_id: string;
  source_rows: number;
  converted_objects: number;
  skipped_variants: number;
  dry_run: boolean;
  stream_result?: unknown;
};

export function parseSuntekImportOptions(argv: string[], env: Record<string, string | undefined> = process.env): SuntekImportOptions {
  const args = parseArgs(argv);
  const input = requiredArg(args, 'input');
  const catalogUrl = trimTrailingSlash(requiredArg(args, 'catalogUrl'));
  const catalogId = requiredArg(args, 'catalogId');
  const providerId = args.providerId ?? DEFAULT_PROVIDER_ID;
  const providerName = args.providerName ?? DEFAULT_PROVIDER_NAME;
  const providerDomain = args.providerDomain ?? DEFAULT_PROVIDER_DOMAIN;
  const providerHomepage = args.providerHomepage ?? DEFAULT_PROVIDER_HOMEPAGE;
  const contactEmail = args.contactEmail ?? DEFAULT_CONTACT_EMAIL;
  const batchId = args.batchId ?? `suntek_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
  const chunkSize = parsePositiveInteger(args.chunkSize ?? String(DEFAULT_CHUNK_SIZE), 'chunk-size');
  if (chunkSize > MAX_CHUNK_SIZE) throw new Error(`--chunk-size must be <= ${MAX_CHUNK_SIZE}`);
  const apiKey = args.apiKey ?? env.SUNTEK_IMPORT_API_KEY ?? env.CATALOG_ADMIN_API_KEY ?? env.API_KEY_DEV;
  const dryRun = args.dryRun === 'true';
  if (!dryRun && !apiKey) {
    throw new Error('An API key is required unless --dry-run=true. Use --api-key or SUNTEK_IMPORT_API_KEY.');
  }

  return {
    input,
    catalogUrl,
    catalogId,
    providerId,
    providerName,
    providerDomain,
    providerHomepage,
    contactEmail,
    batchId,
    chunkSize,
    apiKey,
    dryRun,
  };
}

export async function importSuntekJsonl(options: SuntekImportOptions): Promise<SuntekImportSummary> {
  let providerApiKey: string | undefined;
  let registrationVersion = 1;
  if (!options.dryRun) {
    const registration = registrationResultSchema.parse(await registerProvider(options));
    if (registration.status !== 'accepted_full') {
      throw new Error(`Provider registration was not accepted: ${registration.status}`);
    }
    if (!registration.effective_registration_version) {
      throw new Error('Provider registration result did not include effective_registration_version');
    }
    if (!registration.provider_api_key) {
      throw new Error('Provider registration result did not include provider_api_key');
    }
    registrationVersion = registration.effective_registration_version;
    providerApiKey = registration.provider_api_key;
  }

  const convertedPath = options.dryRun ? undefined : await createStreamingRequest(options, providerApiKey!, registrationVersion);
  const counters = await streamConvertedObjects(options, async (object) => {
    if (!convertedPath) return;
    await convertedPath.writeObject(object);
  });
  const streamResult = convertedPath ? await convertedPath.close() : undefined;

  return {
    input: options.input,
    catalog_id: options.catalogId,
    provider_id: options.providerId,
    registration_version: options.dryRun ? undefined : registrationVersion,
    batch_id: options.batchId,
    source_rows: counters.sourceRows,
    converted_objects: counters.convertedObjects,
    skipped_variants: counters.skippedVariants,
    dry_run: options.dryRun,
    ...(streamResult ? { stream_result: streamResult } : {}),
  };
}

export function convertSuntekProductToObjects(
  product: SuntekSourceProduct,
  options: Pick<SuntekImportOptions, 'providerId'>,
): CommercialObject[] {
  const baseAmount = parseMoneyAmount(product.price.amount, `price.amount for product ${product.id}`);
  const now = new Date().toISOString();
  for (const variant of product.variants) {
    if (variant.price !== undefined) {
      parseMoneyAmount(variant.price, `variant.price for product ${product.id} sku ${variant.sku}`);
    }
    if (variant.weight_grams !== undefined && variant.weight_grams !== null) {
      parseOptionalNumber(variant.weight_grams, `weight_grams for sku ${variant.sku}`);
    }
  }

  const attributes = buildAttributes(product);
  const summary = normalizeSummary(product.ai_summary ?? htmlToText(product.description_html ?? ''));
  const object: CommercialObject = {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `${options.providerId}:${product.id}`,
    object_id: product.id,
    object_type: 'product',
    provider_id: options.providerId,
    title: product.title,
    ...(summary ? { summary } : {}),
    status: 'active',
    provenance: {
      authority_type: 'imported_snapshot',
      provider_id: options.providerId,
      source: 'suntek_jsonl',
      source_site: 'WP_M4X_AInative_DeepLumen_20260622',
      source_object_id: product.id,
      collected_at: now,
      verification_status: 'unverified',
      trust_tier: 'unverified',
    },
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: product.title,
          ...(summary ? { summary } : {}),
          sku: product.variants[0].sku,
          ...(product.images.length > 0 ? { image_urls: product.images } : {}),
          ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: product.price.currency,
          amount: baseAmount,
          price_type: 'fixed',
        },
      },
    ],
  };
  return [commercialObjectSchema.parse(object)];
}

async function streamConvertedObjects(
  options: SuntekImportOptions,
  onObject: (object: CommercialObject) => Promise<void>,
) {
  const seenObjectIds = new Set<string>();
  let sourceRows = 0;
  let convertedObjects = 0;
  let skippedVariants = 0;
  const reader = createInterface({
    input: createReadStream(options.input, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    sourceRows += 1;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at line ${sourceRows}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const product = suntekSourceProductSchema.parse(parsedJson);
    const objects = convertSuntekProductToObjects(product, options);
    for (const object of objects) {
      if (seenObjectIds.has(object.object_id)) {
        throw new Error(`Duplicate object_id ${object.object_id} at source line ${sourceRows}`);
      }
      seenObjectIds.add(object.object_id);
      convertedObjects += 1;
      await onObject(object);
    }
    skippedVariants += 0;
  }

  if (sourceRows === 0) throw new Error('Input JSONL contains no product rows');
  if (convertedObjects === 0) throw new Error('Input JSONL produced no CommercialObject rows');
  return { sourceRows, convertedObjects, skippedVariants };
}

async function registerProvider(options: SuntekImportOptions) {
  const payload = {
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: `provider_reg_${options.providerId}_${Date.now()}`,
    catalog_id: options.catalogId,
    registration_version: 1,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: options.providerId,
      entity_type: 'organization',
      display_name: options.providerName,
      homepage: options.providerHomepage,
      contact_email: options.contactEmail,
      domains: [options.providerDomain],
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'ocp.commerce.product.core.v1#/title',
          'ocp.commerce.product.core.v1#/sku',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
        ],
        optional_fields: [
          'ocp.commerce.product.core.v1#/summary',
          'ocp.commerce.product.core.v1#/image_urls',
          'ocp.commerce.product.core.v1#/attributes',
          'ocp.commerce.inventory.v1#/availability_status',
        ],
        sync: {
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {},
        },
      },
    ],
  };
  const res = await fetch(`${options.catalogUrl}/ocp/providers/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': requiredApiKey(options),
    },
    body: JSON.stringify(payload),
  });
  return readJsonResponse(res, 'provider registration');
}

async function createStreamingRequest(options: SuntekImportOptions, providerApiKey: string, registrationVersion: number) {
  const url = `${options.catalogUrl}/ocp/objects/sync/stream?${new URLSearchParams({
    provider_id: options.providerId,
    registration_version: String(registrationVersion),
    batch_id: options.batchId,
    chunk_size: String(options.chunkSize),
  })}`;
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  const responsePromise = fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-ndjson',
      'x-api-key': providerApiKey,
    },
    body: stream.readable,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  return {
    async writeObject(object: CommercialObject) {
      await writer.write(encoder.encode(`${JSON.stringify(object)}\n`));
    },
    async close() {
      await writer.close();
      const response = await responsePromise;
      return readJsonResponse(response, 'object stream sync');
    },
  };
}

async function readJsonResponse(response: Response, label: string) {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as Record<string, unknown>;
}

function parseMoneyAmount(value: string | number, label: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number`);
  return parsed;
}

function buildAttributes(product: SuntekSourceProduct) {
  return {
    source_product_id: product.id,
    source_file: 'WP_M4X_AInative_DeepLumen_20260622.jsonl',
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      options: variant.options,
      ...(variant.price !== undefined ? { price: parseMoneyAmount(variant.price, `variant.price for product ${product.id} sku ${variant.sku}`) } : {}),
      ...(variant.weight_grams !== undefined && variant.weight_grams !== null
        ? { weight_grams: parseOptionalNumber(variant.weight_grams, `weight_grams for sku ${variant.sku}`) }
        : {}),
    })),
    ...(product.ai_summary ? { ai_summary: product.ai_summary } : {}),
    ...(product.dimensions_cm ? { dimensions_cm: product.dimensions_cm } : {}),
  };
}

function parseOptionalNumber(value: string | number, label: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric`);
  return parsed;
}

function normalizeSummary(value: string) {
  const text = htmlToText(value).replace(/\s+/g, ' ').trim();
  return text.length > 4000 ? text.slice(0, 4000) : text;
}

function htmlToText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function parseArgs(input: string[]) {
  const parsed: Record<string, string> = {};
  for (const item of input) {
    if (!item.startsWith('--')) throw new Error(`Unexpected positional argument: ${item}`);
    const [rawKey, ...rest] = item.slice(2).split('=');
    if (!rawKey) throw new Error(`Invalid argument: ${item}`);
    const value = rest.length > 0 ? rest.join('=') : 'true';
    parsed[toCamelCase(rawKey)] = value;
  }
  return parsed;
}

function requiredArg(args: Record<string, string>, key: string) {
  const value = args[key];
  if (!value?.trim()) throw new Error(`--${toKebabCase(key)} is required`);
  return value.trim();
}

function requiredApiKey(options: SuntekImportOptions) {
  if (!options.apiKey) throw new Error('apiKey is required');
  return options.apiKey;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
