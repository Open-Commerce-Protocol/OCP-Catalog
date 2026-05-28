import {
  type CatalogManifest,
  type CatalogQueryRequest,
  type CatalogQueryResult,
  type ResolveRequest,
  type ResolvableReference,
} from '@ocp-catalog/ocp-schema';
import type { OcpClient } from '@ocp-catalog/ocp-client';
import { mapOcpClientError } from './client-errors';

export class CatalogClient {
  constructor(
    private readonly options: {
      client: OcpClient;
      queryClient?: OcpClient;
    },
  ) {}

  async getManifest(manifestUrl: string): Promise<CatalogManifest> {
    try {
      return await this.options.client.inspectCatalog(manifestUrl);
    } catch (error) {
      mapOcpClientError(error, 'catalog_manifest_unavailable');
    }
  }

  async query(queryUrl: string, body: CatalogQueryRequest): Promise<CatalogQueryResult> {
    try {
      return await (this.options.queryClient ?? this.options.client).queryCatalog(queryUrl, body);
    } catch (error) {
      mapOcpClientError(error, 'catalog_query_failed');
    }
  }

  async resolve(resolveUrl: string, body: ResolveRequest): Promise<ResolvableReference> {
    try {
      return await this.options.client.resolveCatalogEntry(resolveUrl, body);
    } catch (error) {
      mapOcpClientError(error, 'catalog_resolve_failed');
    }
  }
}
