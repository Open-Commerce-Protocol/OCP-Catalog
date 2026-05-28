import {
  type CatalogRouteHint,
  type CatalogSearchRequest,
  type CatalogSearchResult,
} from '@ocp-catalog/registration-schema';
import type { OcpClient } from '@ocp-catalog/ocp-client';
import { mapOcpClientError } from './client-errors';

export class RegistrationClient {
  constructor(private readonly client: OcpClient) {}

  async search(baseUrl: string, body: CatalogSearchRequest): Promise<CatalogSearchResult> {
    try {
      return await this.client.searchCatalogs(baseUrl, body);
    } catch (error) {
      mapOcpClientError(error, 'registration_unavailable');
    }
  }

  async resolve(baseUrl: string, catalogId: string): Promise<CatalogRouteHint> {
    try {
      return await this.client.resolveCatalogRoute(baseUrl, catalogId);
    } catch (error) {
      mapOcpClientError(error, 'registration_unavailable');
    }
  }
}
