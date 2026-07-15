export type RegistrationIdentityConfig = {
  registrationId: string;
  registrationName: string;
  publicBaseUrl: string;
};

export type RegistrationHealthPolicyConfig = {
  healthCheckTimeoutMs: number;
  healthFailureStaleThreshold: number;
};

export type RegistrationRegistryConfig = RegistrationIdentityConfig & RegistrationHealthPolicyConfig;

export type RegistrationRefreshSchedulerConfig = {
  registrationId: string;
  refreshSchedulerEnabled: boolean;
  refreshIntervalSeconds: number;
};
