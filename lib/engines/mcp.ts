import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DmTool } from "../game/types";
import { loadMcpServer, loadMcpTypes } from "./esm";
import { plainSchema } from "./tools";

/**
 * DmTools → an in-process MCP server for Claude Code (server name "dh").
 *
 * Built on the LOW-LEVEL request handlers on purpose (learnharness mcp.ts):
 * the SDK's `tool()` helper wants Zod shapes and validates before our
 * handler runs. Our tools are plain JSON Schema, so schemas are listed
 * verbatim and raw arguments go straight to `call` (runDmTool validates).
 */

export const MCP_SERVER_NAME = "dh";
const PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** The name Claude Code shows the model for one of our tools. */
export function mcpToolName(name: string): string {
	return `${PREFIX}${name}`;
}

/** Back to our tool name (prefix stripped; foreign names kept). */
export function bareToolName(name: string): string {
	return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
}

export type ToolCaller = (name: string, args: unknown) => Promise<CallToolResult>;

export async function createToolServer(tools: readonly DmTool[], call: ToolCaller): Promise<McpSdkServerConfigWithInstance> {
	const [{ McpServer }, { CallToolRequestSchema, ListToolsRequestSchema }] = await Promise.all([loadMcpServer(), loadMcpTypes()]);
	const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" }, { capabilities: { tools: {} } });
	server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: plainSchema(tool.parameters) as { type: "object"; properties?: Record<string, object> },
		})),
	}));
	server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		try {
			return await call(name, args ?? {});
		} catch (error) {
			return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
		}
	});
	return { type: "sdk", name: MCP_SERVER_NAME, instance: server };
}
