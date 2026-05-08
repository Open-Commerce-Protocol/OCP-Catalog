import { createWebMcpRuntime } from '@ocp-catalog/webmcp-adapter';
import { useEffect, useRef } from 'react';
import { ocpUserDemoWebMcpManifest } from './manifest';
import { createOcpUserDemoWebMcpTools, type OcpUserDemoWebMcpContext } from './tools';

export function useOcpUserDemoWebMcp(context: OcpUserDemoWebMcpContext) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const runtime = createWebMcpRuntime();
    const registration = runtime.registerTools(createOcpUserDemoWebMcpTools(contextRef));

    return () => {
      registration.unregister();
      runtime.cleanup();
    };
  }, []);

  return ocpUserDemoWebMcpManifest;
}
