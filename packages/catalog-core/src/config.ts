export type CatalogIdentityConfig = {
  catalogId: string;
  catalogName: string;
  publicBaseUrl: string;
};

export type CatalogRuntimePolicyConfig = {
  providerThrottleEnabled: boolean;
};

export type CatalogCoreConfig = CatalogIdentityConfig & CatalogRuntimePolicyConfig;
