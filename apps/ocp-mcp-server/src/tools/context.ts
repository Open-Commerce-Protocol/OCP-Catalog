import type { McpGatewayConfig } from '../config';
import type { CatalogClient } from '../ocp/catalog-client';
import type { RegistrationClient } from '../ocp/registration-client';

export type ToolDeps = {
  config: McpGatewayConfig;
  registrationClient: RegistrationClient;
  catalogClient: CatalogClient;
};
