import { createWebMcpRuntime } from '@ocp-catalog/webmcp-adapter';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OcpMcpToolMetadata } from '../mcp/client';
import { createOcpMcpDemoWebMcpTools, toWebMcpToolName, type OcpMcpDemoContext } from './tools';

export function useOcpMcpDemoWebMcp(
  context: OcpMcpDemoContext,
  mcpTools: readonly OcpMcpToolMetadata[],
) {
  const [available, setAvailable] = useState(false);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (!shouldRegisterOcpMcpDemoTools(mcpTools)) {
      return;
    }

    const runtime = createWebMcpRuntime();
    setAvailable(runtime.isAvailable);
    const registration = runtime.registerTools(createOcpMcpDemoWebMcpTools({
      getState: () => contextRef.current.getState(),
      callMcpTool: (name, args) => contextRef.current.callMcpTool(name, args),
      recordCall: (record) => contextRef.current.recordCall(record),
    }, mcpTools));

    return () => {
      registration.unregister();
      runtime.cleanup();
    };
  }, [mcpTools]);

  return useMemo(() => ({
    available,
    tools: [
      'ocp.mcp.get_page_state',
      ...mcpTools.map((tool) => toWebMcpToolName(tool.name)),
    ],
  }), [available, mcpTools]);
}

export function shouldRegisterOcpMcpDemoTools(mcpTools: readonly OcpMcpToolMetadata[]) {
  return mcpTools.length > 0;
}
