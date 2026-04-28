export type McpGatewayErrorCode =
  | 'configuration_error'
  | 'registration_unavailable'
  | 'catalog_not_found'
  | 'catalog_manifest_unavailable'
  | 'invalid_query_pack'
  | 'invalid_filter_field'
  | 'catalog_query_failed'
  | 'catalog_resolve_failed';

export class McpToolError extends Error {
  constructor(
    readonly code: McpGatewayErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

export function errorResult(error: unknown) {
  if (error instanceof McpToolError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    error: {
      code: 'internal_error',
      message: error instanceof Error ? error.message : 'Unknown MCP gateway error',
    },
  };
}
