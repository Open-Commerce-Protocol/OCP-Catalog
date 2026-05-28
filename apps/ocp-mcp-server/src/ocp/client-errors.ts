import { OcpClientError } from '@ocp-catalog/ocp-client';
import { McpToolError, type McpGatewayErrorCode } from '../errors';

export function mapOcpClientError(error: unknown, code: McpGatewayErrorCode): never {
  if (error instanceof OcpClientError) {
    throw new McpToolError(code, error.message, { ...error.details });
  }

  throw error;
}
