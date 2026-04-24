import { catalogManifestSchema, type CatalogManifest } from '@ocp-catalog/ocp-schema';
import { AppError } from '@ocp-catalog/shared';

export type CatalogDiscovery = {
  ocp_version: '1.0';
  kind: 'WellKnownCatalogDiscovery';
  catalog_id: string;
  catalog_name: string;
  manifest_url: string;
  query_url?: string;
  resolve_url?: string;
  contracts_url?: string;
};

export async function fetchCatalogProfile(wellKnownUrl: string) {
  const discovery = await fetchJson<CatalogDiscovery>(wellKnownUrl);
  if (!discovery.catalog_id || !discovery.manifest_url) {
    throw new AppError('validation_error', 'Catalog discovery document is missing catalog_id or manifest_url', 400);
  }

  const manifestInput = await fetchJson<unknown>(discovery.manifest_url);
  const manifest = catalogManifestSchema.parse(manifestInput);

  return { discovery, manifest };
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new AppError('validation_error', `Failed to fetch ${url}`, 400, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok) {
    throw new AppError('validation_error', `Failed to fetch ${url}`, 400, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response.json() as Promise<T>;
}

export function validateFetchedCatalog(
  registration: { catalog_id: string; claimed_domains: string[] },
  discovery: CatalogDiscovery,
  manifest: CatalogManifest,
) {
  const warnings: string[] = [];

  if (discovery.catalog_id !== registration.catalog_id) {
    throw new AppError('validation_error', 'Discovery catalog_id does not match registration catalog_id', 400, {
      registration_catalog_id: registration.catalog_id,
      discovery_catalog_id: discovery.catalog_id,
    });
  }

  if (manifest.catalog_id !== registration.catalog_id) {
    throw new AppError('validation_error', 'Manifest catalog_id does not match registration catalog_id', 400, {
      registration_catalog_id: registration.catalog_id,
      manifest_catalog_id: manifest.catalog_id,
    });
  }

  if (!manifest.endpoints.query?.url) warnings.push('Manifest does not declare a query endpoint.');
  if (manifest.query_capabilities.length === 0) warnings.push('Manifest does not declare query capabilities.');

  const endpointUrls = [
    manifest.endpoints.query?.url,
    manifest.endpoints.resolve?.url,
    manifest.endpoints.contracts?.url,
    manifest.endpoints.provider_registration?.url,
    manifest.endpoints.object_sync?.url,
  ].filter(Boolean);

  for (const endpointUrl of endpointUrls) {
    const hostname = new URL(endpointUrl).hostname;
    if (!registration.claimed_domains.includes(hostname) && !isLocalhost(hostname)) {
      warnings.push(`Endpoint ${endpointUrl} is outside claimed domains.`);
    }
  }

  return warnings;
}

export function isLocalhost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
