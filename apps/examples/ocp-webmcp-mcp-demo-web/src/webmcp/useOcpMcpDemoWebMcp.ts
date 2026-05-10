import { createWebMcpRuntime } from '@ocp-catalog/webmcp-adapter';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createOcpMcpDemoWebMcpTools, type OcpMcpDemoContext } from './tools';

export function useOcpMcpDemoWebMcp(context: OcpMcpDemoContext) {
  const [available, setAvailable] = useState(false);
  const tools = useMemo(() => createOcpMcpDemoWebMcpTools(context), []);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const runtime = createWebMcpRuntime();
    setAvailable(runtime.isAvailable);
    const registration = runtime.registerTools(createOcpMcpDemoWebMcpTools({
      getState: () => contextRef.current.getState(),
      listProducts: (input) => contextRef.current.listProducts(input),
      searchProducts: (input) => contextRef.current.searchProducts(input),
      setDataSource: (input) => contextRef.current.setDataSource(input),
      openProductPage: (input) => contextRef.current.openProductPage(input),
      recordCall: (record) => contextRef.current.recordCall(record),
    }));

    return () => {
      registration.unregister();
      runtime.cleanup();
    };
  }, []);

  return useMemo(() => ({
    available,
    tools: tools.map((tool) => tool.name),
  }), [available, tools]);
}
