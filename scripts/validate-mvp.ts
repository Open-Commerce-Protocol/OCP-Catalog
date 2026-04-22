const baseUrl = (process.env.CATALOG_PUBLIC_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const apiKey = process.env.API_KEY_DEV ?? 'dev-api-key';
const catalogId = process.env.CATALOG_ID ?? 'cat_local_dev';
const providerId = `validate_provider_${Date.now()}`;

const checks: string[] = [];

await check('Catalog health', async () => {
  const health = await get('/health');
  assert(health.ok === true, 'health.ok should be true');
});

await check('Well-known discovery', async () => {
  const discovery = await get('/.well-known/ocp-catalog');
  assert(discovery.catalog_id === catalogId, 'catalog_id should match');
  assert(typeof discovery.manifest_url === 'string', 'manifest_url should be present');
});

await check('Manifest contracts', async () => {
  const manifest = await get('/ocp/manifest');
  assert(manifest.kind === 'CatalogManifest', 'manifest kind should match');
  assert(manifest.endpoints.object_sync.url, 'object_sync endpoint should exist');
  const contracts = await get('/ocp/contracts?object_type=product');
  assert(contracts.contracts.length === 1, 'product contract should exist');
});

await check('Provider registration v1 succeeds', async () => {
  const result = await register(1);
  assert(result.status === 'accepted_full', `expected accepted_full, got ${result.status}`);
});

await check('Duplicate low registration does not override active state', async () => {
  const result = await register(1);
  assert(result.effective_registration_version === 1, 'effective version should remain 1');
  const provider = await get(`/ocp/providers/${providerId}`);
  assert(provider.active_registration_version === 1, 'active version should remain 1');
});

await check('Higher registration version updates active state', async () => {
  const result = await register(2);
  assert(result.status === 'accepted_full', `expected accepted_full, got ${result.status}`);
  const provider = await get(`/ocp/providers/${providerId}`);
  assert(provider.active_registration_version === 2, 'active version should become 2');
});

await check('Lower registration after update does not override active state', async () => {
  await register(1);
  const provider = await get(`/ocp/providers/${providerId}`);
  assert(provider.active_registration_version === 2, 'active version should remain 2');
});

let acceptedEntryId = '';

await check('Object sync accepts valid items and rejects invalid items', async () => {
  const result = await post('/ocp/objects/sync', syncRequest(2));
  assert(result.status === 'partial', `expected partial, got ${result.status}`);
  assert(result.accepted_count >= 2, 'valid and upsert items should be accepted');
  assert(result.rejected_count === 2, 'two invalid items should be rejected');
  const accepted = result.items.find((item: any) => item.status === 'accepted' && item.object_id === 'flower-orchid-001');
  assert(accepted?.catalog_entry_id, 'accepted item should include catalog_entry_id');
  acceptedEntryId = accepted.catalog_entry_id;
});

await check('Query keyword finds synced product with explain', async () => {
  const result = await post('/ocp/query', {
    ocp_version: '1.0',
    kind: 'CatalogQueryRequest',
    query: 'orchid',
    limit: 10,
    explain: true,
  }, false);
  assert(result.items.some((item: any) => item.entry_id === acceptedEntryId), 'orchid query should find synced entry');
  assert(result.explain.length > 0, 'query explain should be present');
});

await check('Query structured filters apply', async () => {
  const result = await post('/ocp/query', {
    query: '',
    filters: { category: 'flowers', availability_status: 'in_stock', provider_id: providerId },
    limit: 10,
    explain: true,
  }, false);
  assert(result.items.length >= 1, 'filtered query should return at least one item');
  assert(result.items.every((item: any) => item.attributes.category === 'flowers'), 'all items should match category filter');
});

await check('Resolve returns ResolvableReference with URL action binding', async () => {
  const result = await post('/ocp/resolve', {
    ocp_version: '1.0',
    kind: 'ResolveRequest',
    entry_id: acceptedEntryId,
  }, false);
  assert(result.kind === 'ResolvableReference', 'resolve kind should match');
  assert(result.action_bindings.some((binding: any) => binding.action_id === 'view_product' && binding.url), 'view_product URL binding should exist');
});

console.log(`\nMVP validation passed (${checks.length} checks).`);
for (const label of checks) console.log(`- ${label}`);

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    checks.push(label);
    console.log(`ok - ${label}`);
  } catch (error) {
    console.error(`failed - ${label}`);
    throw error;
  }
}

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  return parse(response);
}

async function post(path: string, body: unknown, writeAuth = true) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(writeAuth ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return parse(response);
}

async function parse(response: Response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function register(version: number) {
  return post('/ocp/providers/register', {
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: `reg_${providerId}_${version}`,
    catalog_id: catalogId,
    registration_version: version,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: providerId,
      entity_type: 'merchant',
      display_name: 'Validation Commerce Provider',
      homepage: 'https://validation-commerce.example.test',
    },
    object_declarations: [
      {
        object_type: 'product',
        provided_packs: [
          'ocp.commerce.product.core.v1',
          'ocp.commerce.price.v1',
          'ocp.commerce.inventory.v1',
        ],
        guaranteed_fields: ['ocp.commerce.product.core.v1#/title'],
        optional_fields: [
          'ocp.commerce.product.core.v1#/category',
          'ocp.commerce.product.core.v1#/product_url',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
          'ocp.commerce.inventory.v1#/availability_status',
        ],
        delivery: { mode: 'push_api' },
      },
    ],
  });
}

function syncRequest(version: number) {
  const valid = commercialObject('flower-orchid-001', 'White Orchid Arrangement', 'flowers', 'in_stock');
  const upsert = commercialObject('flower-orchid-001', 'White Orchid Arrangement Updated', 'flowers', 'in_stock');
  const missingPack = commercialObject('invalid-missing-pack', 'Invalid Missing Pack', 'flowers', 'in_stock');
  missingPack.descriptors = missingPack.descriptors.filter((descriptor: any) => descriptor.pack_id !== 'ocp.commerce.product.core.v1');
  const missingField = commercialObject('invalid-missing-field', 'Invalid Missing Field', 'electronics', 'in_stock');
  const coreDescriptor = missingField.descriptors.find((descriptor: any) => descriptor.pack_id === 'ocp.commerce.product.core.v1');
  delete coreDescriptor.data.title;

  return {
    ocp_version: '1.0',
    kind: 'ObjectSyncRequest',
    catalog_id: catalogId,
    provider_id: providerId,
    registration_version: version,
    batch_id: `validate_batch_${Date.now()}`,
    objects: [
      valid,
      upsert,
      commercialObject('electronics-headphones-001', 'Noise Cancelling Headphones', 'electronics', 'low_stock'),
      missingPack,
      missingField,
    ],
  };
}

function commercialObject(
  objectId: string,
  title: string,
  category: string,
  availabilityStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder' | 'unknown',
) {
  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${providerId}_${objectId}`,
    object_id: objectId,
    object_type: 'product',
    provider_id: providerId,
    title,
    summary: `${title} validation sample`,
    status: 'active',
    source_url: `https://validation-commerce.example.test/products/${objectId}`,
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title,
          summary: `${title} validation sample`,
          brand: 'Validation Brand',
          category,
          product_url: `https://validation-commerce.example.test/products/${objectId}`,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: 'USD',
          amount: 42,
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: availabilityStatus,
          quantity: 10,
        },
      },
    ],
  };
}
