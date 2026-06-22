import { loadConfig } from '@ocp-catalog/config';
import { createSchemaDb, type DbOptions } from '@ocp-catalog/db';
import * as registrationSchema from './schema';

export { registrationSchema };
export * from './schema';

export type RegistrationDbOptions = DbOptions;
export type RegistrationDb = ReturnType<typeof createRegistrationDb>;

export function createRegistrationDb(databaseUrl = loadConfig().DATABASE_URL, options: RegistrationDbOptions = {}) {
  return createSchemaDb(registrationSchema, databaseUrl, options);
}
