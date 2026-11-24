import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

interface PiHostInternals {
	AgentRegistry?: {
		global(): {
			get(id: string): {
				session?: {
					newSession(options?: { parentSession?: string }): Promise<boolean>;
					extensionRunner?: {
						createCommandContext(): {
							newSession(options?: { parentSession?: string }): Promise<{ cancelled: boolean }>;
						};
					};
				};
			} | undefined;
		};
	};
	MAIN_AGENT_ID?: string;
}

export default function newSessionExtension(pi: ExtensionAPI): void {
	const handledSessions = new WeakSet<object>();

	pi.registerFlag("new", {
		description: "Start a fresh persistent session (bypasses autoResume)",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		if (handledSessions.has(ctx.sessionManager)) return;
		if (pi.getFlag("new") !== true) return;
		if (ctx.agent.kind !== "main") return;
		if (ctx.sessionManager.getEntries().length === 0) return;

		handledSessions.add(ctx.sessionManager);

		if (!("pi" in pi) || !pi.pi || typeof pi.pi !== "object") return;
		const host = pi.pi as PiHostInternals;
		const mainId = host.MAIN_AGENT_ID ?? "main";
		const mainSession = host.AgentRegistry?.global().get(mainId)?.session;
		if (!mainSession) return;

		if (ctx.mode === "tui" && mainSession.extensionRunner) {
			const cmdCtx = mainSession.extensionRunner.createCommandContext();
			await cmdCtx.newSession();
		} else {
			await mainSession.newSession();
		}
	});
}
