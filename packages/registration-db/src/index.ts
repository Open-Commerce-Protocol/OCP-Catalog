import { createSchemaDb, type DbOptions } from '@ocp-catalog/db';
import * as registrationSchema from './schema';

export { registrationSchema };
export * from './schema';

export type RegistrationDbOptions = DbOptions;
export type RegistrationDb = ReturnType<typeof createRegistrationDb>;

export function createRegistrationDb(databaseUrl: string, options: RegistrationDbOptions = {}) {
  return createSchemaDb(registrationSchema, databaseUrl, options);
}
