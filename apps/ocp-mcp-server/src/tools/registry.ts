import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  FindAndQueryCatalogInput,
  InspectCatalogInput,
  QueryCatalogInput,
  ResolveCatalogEntryInput,
  SearchCatalogsInput,
} from '../schemas/tool-inputs';
import { describeOcpCatalog } from '../ocp/self-description';
import type { ToolDeps } from './context';
import { OCP_TOOL_DEFINITIONS } from './definitions';
import { findAndQueryCatalogTool } from './find-and-query-catalog';
import { inspectCatalogTool } from './inspect-catalog';
import { queryCatalogTool } from './query-catalog';
import { resolveCatalogEntryTool } from './resolve-catalog-entry';
import { searchCatalogsTool } from './search-catalogs';

type ToolResultRunner = (run: () => Promise<unknown>) => Promise<{
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  content: { type: 'text'; text: string }[];
}>;

export function registerOcpTools(server: McpServer, deps: ToolDeps, toolResult: ToolResultRunner) {
  for (const definition of OCP_TOOL_DEFINITIONS) {
    server.registerTool(
      definition.id,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      },
      async (args: unknown) => {
        switch (definition.id) {
          case 'describe_ocp_catalog':
            return toolResult(async () => describeOcpCatalog());
          case 'search_catalogs':
            return toolResult(() => searchCatalogsTool(args as SearchCatalogsInput, deps));
          case 'inspect_catalog':
            return toolResult(() => inspectCatalogTool(args as InspectCatalogInput, deps));
          case 'query_catalog':
            return toolResult(() => queryCatalogTool(args as QueryCatalogInput, deps));
          case 'resolve_catalog_entry':
            return toolResult(() => resolveCatalogEntryTool(args as ResolveCatalogEntryInput, deps));
          case 'find_and_query_catalog':
            return toolResult(() => findAndQueryCatalogTool(args as FindAndQueryCatalogInput, deps));
        }
      },
    );
  }
}
