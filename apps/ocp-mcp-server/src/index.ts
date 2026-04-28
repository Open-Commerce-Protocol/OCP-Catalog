import { loadMcpGatewayConfig } from './config';
import { startMcpServer } from './server';

const config = loadMcpGatewayConfig();

await startMcpServer(config);
