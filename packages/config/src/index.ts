import { z } from 'zod';
import { readDotEnv } from './dotenv';

export { readDotEnv } from './dotenv';

export const runtimeBoolean = z.union([
  z.boolean(),
  z.enum(['true', '1', 'false', '0']).transform((value) => value === 'true' || value === '1'),
]);

export type LoadEnvOptions = {
  includeDotEnv?: boolean;
};

export function loadEnv(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): Record<string, string | undefined> {
  return {
    ...(options.includeDotEnv === false ? {} : readDotEnv()),
    ...env,
  };
}
