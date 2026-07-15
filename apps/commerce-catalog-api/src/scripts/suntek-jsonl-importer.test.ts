import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import {
  convertSuntekProductToObjects,
  importSuntekJsonl,
  parseSuntekImportOptions,
  suntekSourceProductSchema,
} from './suntek-jsonl-importer';

const sourceProduct = {
  id: '10001295925',
  title: 'Unicorn Bun Stress Toy Smooth Surface Squishy Unicorn Bun Anxiety Relief',
  description_html: '<p>Unicorn Bun Stress Toy Smooth Surface Squishy Unicorn Bun Anxiety Relief</p>',
  price: { amount: '9.99', currency: 'USD' },
  images: ['https://example.com/image.jpg'],
  variants: [
    {
      sku: 'dcd-30003679291',
      options: { Color: 'Orange' },
      price: '9.99',
      weight_grams: 150,
    },
    {
      sku: 'dcd-30003679292',
      options: { Color: 'Yellow' },
      price: '10.99',
      weight_grams: 160,
    },
  ],
  ai_summary: 'Soft unicorn stress toy for fidget use.',
  dimensions_cm: { length: '10', width: '10', height: '6' },
};

describe('Suntek JSONL importer', () => {
  test('converts each source product into one strict CommercialObject', () => {
    const parsed = suntekSourceProductSchema.parse(sourceProduct);
    const objects = convertSuntekProductToObjects(parsed, { providerId: 'suntek' });

    expect(objects).toHaveLength(1);
    expect(objects[0].object_id).toBe('10001295925');
    expect(objects[0].provider_id).toBe('suntek');
    expect(objects[0].descriptors.map((descriptor) => descriptor.pack_id)).toEqual([
      'ocp.commerce.product.core.v1',
      'ocp.commerce.price.v1',
    ]);
    expect(objects[0].descriptors[1].data).toMatchObject({ currency: 'USD', amount: 9.99 });
    expect(objects[0].descriptors[0].data.attributes).toMatchObject({
      source_product_id: '10001295925',
      variants: [
        { sku: 'dcd-30003679291', price: 9.99 },
        { sku: 'dcd-30003679292', price: 10.99 },
      ],
    });
  });

  test('fails loud when a source price is not numeric', () => {
    const invalid = suntekSourceProductSchema.parse({
      ...sourceProduct,
      variants: [{ ...sourceProduct.variants[0], price: 'not-money' }],
    });

    expect(() => convertSuntekProductToObjects(invalid, { providerId: 'suntek' }))
      .toThrow('variant.price for product 10001295925 sku dcd-30003679291 must be a non-negative number');
  });

  test('dry-run reads JSONL and rejects duplicate object ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'suntek-import-'));
    const input = join(dir, 'products.jsonl');
    await writeFile(input, `${JSON.stringify(sourceProduct)}\n${JSON.stringify(sourceProduct)}\n`, 'utf8');
    const options = parseSuntekImportOptions([
      `--input=${input}`,
      '--catalog-url=http://127.0.0.1:4000',
      '--catalog-id=cat_suntek_deeplumen',
      '--dry-run=true',
    ]);

    await expect(importSuntekJsonl(options)).rejects.toThrow('Duplicate object_id');
  });

  test('dry-run returns conversion summary for valid JSONL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'suntek-import-'));
    const input = join(dir, 'products.jsonl');
    await writeFile(input, `${JSON.stringify(sourceProduct)}\n`, 'utf8');
    const options = parseSuntekImportOptions([
      `--input=${input}`,
      '--catalog-url=http://127.0.0.1:4000',
      '--catalog-id=cat_suntek_deeplumen',
      '--dry-run=true',
    ]);

    await expect(importSuntekJsonl(options)).resolves.toMatchObject({
      source_rows: 1,
      converted_objects: 1,
      skipped_variants: 0,
      dry_run: true,
    });
  });

  test('requires an API key for non-dry-run imports', () => {
    expect(() => parseSuntekImportOptions([
      '--input=products.jsonl',
      '--catalog-url=http://127.0.0.1:4000',
      '--catalog-id=cat_suntek_deeplumen',
    ], {})).toThrow('An API key is required unless --dry-run=true');
  });
});
