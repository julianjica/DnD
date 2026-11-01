/**
 * Lazy loaders for the ESM-only engine dependencies.
 *
 * The app's package.json has no `"type": "module"`, so tsx (tests, scripts)
 * compiles our `.ts` as CommonJS, and a static `import { x } from "pi-ai"`
 * fails with ERR_PACKAGE_PATH_NOT_EXPORTED (these packages only export an
 * `import` condition). Every runtime use goes through a dynamic import here;
 * modules keep `import type` for types. Next's bundler handles both forms.
 */

type PiAi = typeof import("@earendil-works/pi-ai");
type PiAgentCore = typeof import("@earendil-works/pi-agent-core");
type ClaudeAgentSdk = typeof import("@anthropic-ai/claude-agent-sdk");
type McpServerModule = typeof import("@modelcontextprotocol/sdk/server/mcp.js");
type McpTypesModule = typeof import("@modelcontextprotocol/sdk/types.js");
type PiProviders = typeof import("@earendil-works/pi-ai/providers/all");

let piAi: Promise<PiAi> | undefined;
let piAgentCore: Promise<PiAgentCore> | undefined;
let claudeSdk: Promise<ClaudeAgentSdk> | undefined;
let mcpServer: Promise<McpServerModule> | undefined;
let mcpTypes: Promise<McpTypesModule> | undefined;
let piProviders: Promise<PiProviders> | undefined;

export const loadPiAi = (): Promise<PiAi> => (piAi ??= import("@earendil-works/pi-ai"));
export const loadPiAgentCore = (): Promise<PiAgentCore> => (piAgentCore ??= import("@earendil-works/pi-agent-core"));
export const loadClaudeSdk = (): Promise<ClaudeAgentSdk> => (claudeSdk ??= import("@anthropic-ai/claude-agent-sdk"));
export const loadMcpServer = (): Promise<McpServerModule> => (mcpServer ??= import("@modelcontextprotocol/sdk/server/mcp.js"));
export const loadMcpTypes = (): Promise<McpTypesModule> => (mcpTypes ??= import("@modelcontextprotocol/sdk/types.js"));
export const loadPiProviders = (): Promise<PiProviders> => (piProviders ??= import("@earendil-works/pi-ai/providers/all"));
