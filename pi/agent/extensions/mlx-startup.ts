import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PI_DIR = join(EXTENSION_DIR, "..", "..");
const START_SCRIPT = join(PI_DIR, "start-mlx-server.sh");
const LOG_DIR = join(PI_DIR, "logs");
const LOG_PATH = join(LOG_DIR, "mlx-startup.log");

export default function mlxStartupExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (process.env.PI_AUTO_START_MLX === "0") {
			return;
		}

		if (!existsSync(START_SCRIPT)) {
			ctx.ui.notify(`MLX startup script not found: ${relative(ctx.cwd, START_SCRIPT)}`, "warning");
			return;
		}

		mkdirSync(LOG_DIR, { recursive: true });
		const logFd = openSync(LOG_PATH, "a");

		try {
			const child = spawn("bash", [START_SCRIPT], {
				cwd: PI_DIR,
				detached: true,
				stdio: ["ignore", logFd, logFd],
			});

			child.unref();
			ctx.ui.notify(`Starting MLX server via ${relative(ctx.cwd, START_SCRIPT)}`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Failed to start MLX server: ${message}`, "error");
		} finally {
			closeSync(logFd);
		}
	});
}
