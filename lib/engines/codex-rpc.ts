import { spawn } from "node:child_process";
import { codexExecutable } from "./cli";

/**
 * The `codex app-server` wire (ported as-is from learnharness codex/rpc.ts).
 *
 * One app-server child per turn, speaking JSON-RPC as one JSON object per
 * line over stdio (no "jsonrpc" field). Three message kinds flow: our
 * requests and their responses, server notifications, and SERVER requests
 * (`item/tool/call`) that we answer by id.
 *
 * The transport is a seam: production spawns the CLI; tests hand in a
 * scripted in-process fake speaking the same messages.
 */

export type RpcId = number | string;
export interface RpcMessage {
	id?: RpcId;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code?: number; message?: string };
}

export interface CodexTransport {
	send(message: RpcMessage): void;
	onMessage(listener: (message: RpcMessage) => void): void;
	/** Fires once when the peer goes away; `reason` is set for a failure. */
	onClose(listener: (reason?: string) => void): void;
	close(): void;
}

export interface SpawnOptions {
	cwd: string;
	env: Record<string, string>;
	stderr?: (data: string) => void;
}
export type ConnectFn = (options: SpawnOptions) => CodexTransport;

/**
 * Feature switches and config overrides that make Codex a bare model
 * runner: no shell, no web, no skills/apps/plugins/MCP from the user's
 * config, no injected environment or permission prose. Code mode stays
 * ON — current Codex models are code-mode-only and reach our dynamic
 * tools through it (disabling code_mode_host makes every tool call fail).
 */
export const DISABLED_FEATURES = [
	"apps", "plugins", "multi_agent", "skill_search", "shell_tool", "unified_exec", "view_image", "image_generation", "goals",
	"computer_use", "browser_use", "browser_use_external", "in_app_browser", "tool_suggest", "memories", "recommended_plugins",
	"personality", "hooks", "workspace_dependencies", "shell_snapshot",
];
export const CONFIG_OVERRIDES = [
	'web_search="disabled"',
	"mcp_servers={}",
	"include_environment_context=false",
	"include_permissions_instructions=false",
	"include_apps_instructions=false",
	"include_collaboration_mode_instructions=false",
	"skills.include_instructions=false",
	"project_doc_max_bytes=0",
	"tools.update_plan={enabled=false}",
	"tools.experimental_request_user_input={enabled=false}",
];

export function codexArgs(): string[] {
	const args = ["app-server"];
	for (const feature of DISABLED_FEATURES) args.push("--disable", feature);
	for (const override of CONFIG_OVERRIDES) args.push("-c", override);
	return args;
}

/** Production transport: spawn the CLI, frame stdio by lines. */
export const spawnCodex: ConnectFn = (options) => {
	const executable = codexExecutable() ?? "codex";
	const child = spawn(executable, codexArgs(), { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
	const listeners = new Set<(message: RpcMessage) => void>();
	const closers = new Set<(reason?: string) => void>();
	let closed = false;
	let stderrTail = "";
	const finish = (reason?: string) => {
		if (closed) return;
		closed = true;
		for (const close of closers) close(reason);
	};
	let buffer = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		buffer += chunk;
		let newline: number;
		while ((newline = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			let message: RpcMessage;
			try {
				message = JSON.parse(line) as RpcMessage;
			} catch {
				continue;
			}
			for (const listener of listeners) listener(message);
		}
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderrTail = (stderrTail + chunk).slice(-2000);
		options.stderr?.(chunk);
	});
	child.stdin.on("error", () => undefined); // EPIPE after the child died; `exit` reports it
	child.on("error", (error: NodeJS.ErrnoException) => {
		finish(error.code === "ENOENT" ? `Codex CLI not found (${executable}). Install Codex or set DH_CODEX_PATH.` : error.message);
	});
	child.on("exit", (code, signal) => {
		finish(code === 0 || signal === "SIGTERM" ? undefined : `Codex exited (${signal ?? code})${stderrTail.trim() ? `: ${stderrTail.trim().split("\n").at(-1)}` : ""}`);
	});
	return {
		send(message) {
			if (!closed && child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
		},
		onMessage(listener) {
			listeners.add(listener);
		},
		onClose(listener) {
			closers.add(listener);
		},
		close() {
			if (!child.killed) child.kill("SIGTERM");
		},
	};
};

/** Request/response bookkeeping over a transport. */
export class CodexClient {
	private nextId = 1;
	private readonly pending = new Map<RpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private closedReason: string | undefined;
	private isClosed = false;

	constructor(
		private readonly transport: CodexTransport,
		handlers: {
			notification: (method: string, params: unknown) => void;
			request: (method: string, params: unknown) => Promise<unknown>;
			closed: (reason?: string) => void;
		},
	) {
		transport.onMessage((message) => {
			if (message.method !== undefined && message.id !== undefined) {
				const id = message.id;
				handlers.request(message.method, message.params).then(
					(result) => transport.send({ id, result }),
					(error: unknown) => transport.send({ id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }),
				);
			} else if (message.method !== undefined) {
				handlers.notification(message.method, message.params);
			} else if (message.id !== undefined) {
				const waiter = this.pending.get(message.id);
				if (!waiter) return;
				this.pending.delete(message.id);
				if (message.error) waiter.reject(new Error(message.error.message ?? "Codex request failed"));
				else waiter.resolve(message.result);
			}
		});
		transport.onClose((reason) => {
			this.isClosed = true;
			this.closedReason = reason;
			for (const waiter of this.pending.values()) waiter.reject(new Error(reason ?? "Codex closed the connection"));
			this.pending.clear();
			handlers.closed(reason);
		});
	}

	request<T = unknown>(method: string, params: unknown): Promise<T> {
		if (this.isClosed) return Promise.reject(new Error(this.closedReason ?? "Codex closed the connection"));
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.transport.send({ id, method, params });
		});
	}

	notify(method: string, params?: unknown): void {
		this.transport.send(params === undefined ? { method } : { method, params });
	}

	close(): void {
		this.transport.close();
	}
}

export const CLIENT_INFO = { clientInfo: { name: "dungeonharness", title: "DungeonHarness", version: "1" }, capabilities: { experimentalApi: true } };
