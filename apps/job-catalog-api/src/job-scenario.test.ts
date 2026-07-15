import { describe, expect, test } from 'bun:test';
import { buildCatalogManifest } from '@ocp-catalog/catalog-core';
import type { CommercialObject } from '@ocp-catalog/ocp-schema';
import { createJobCatalogScenario } from './job-scenario';
import { JOB_POSTING_PACK_ID, JOB_WORKPLACE_PACK_ID } from './job-packs';

describe('createJobCatalogScenario', () => {
  test('builds a valid job manifest without declaring semantic when disabled', () => {
    const scenario = createJobCatalogScenario({ semanticQueryEnabled: false });
    const manifest = buildCatalogManifest({
      catalogId: 'cat_ocp_jobs_prod',
      catalogName: 'OCP Overseas Jobs Catalog',
      publicBaseUrl: 'https://overseajobs.catalog.pageflux.net',
    } as any, scenario);

    expect(manifest.catalog_id).toBe('cat_ocp_jobs_prod');
    expect(manifest.query_capabilities[0]?.capability_id).toBe('ocp.job.search.v1');
    expect(JSON.stringify(manifest.query_capabilities)).not.toContain('ocp.query.semantic.v1');
  });

  test('validates required posting URLs fail-loud', () => {
    const scenario = createJobCatalogScenario();
    const result = scenario.validateDescriptorPack(JOB_POSTING_PACK_ID, {
      title: 'AI Engineer',
      company_name: 'Example',
      location_text: 'San Francisco, CA',
    });

    expect(result.ok).toBe(false);
  });

  test('projects job-specific searchable attributes', () => {
    const scenario = createJobCatalogScenario();
    const object: CommercialObject = {
      ocp_version: '1.0',
      kind: 'CommercialObject',
      id: 'jobspy:1',
      object_id: '1',
      object_type: 'job',
      provider_id: 'jobspy',
      title: 'AI Tooling Engineer',
      status: 'active',
      source_url: 'https://example.com/job/1',
      descriptors: [
        {
          pack_id: JOB_POSTING_PACK_ID,
          data: {
            title: 'AI Tooling Engineer',
            company_name: 'Qventus',
            location_text: 'San Francisco, CA, US',
            job_url: 'https://example.com/job/1',
            site: 'indeed',
          },
        },
        {
          pack_id: JOB_WORKPLACE_PACK_ID,
          data: {
            location_text: 'San Francisco, CA, US',
            is_remote: false,
          },
        },
      ],
    };

    const projection = scenario.buildSearchProjection(object);
    expect(projection.company).toBe('Qventus');
    expect(projection.location).toBe('San Francisco, CA, US');
    expect(projection.text).toContain('ai tooling engineer');
  });
});
