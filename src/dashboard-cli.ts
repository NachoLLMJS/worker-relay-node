import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { buildDashboardServer } from "./dashboard-server.js";
import { buildWorkerExecutor } from "./provider-registry.js";
import { runWorkerOnce } from "./worker.js";
import { WorkerRuntime } from "./worker-runtime.js";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function openBrowser(url: string): void {
  if (process.env.DASHBOARD_AUTO_OPEN?.trim().toLowerCase() === "false" || process.argv.includes("--no-open")) return;
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

const apiUrl = required("COORDINATOR_URL");
const workerToken = required("WORKER_ACCESS_TOKEN");
const workerId = process.env.WORKER_NAME?.trim() || "friend-worker-1";
const provider = buildWorkerExecutor();
const acceptPublicRequests = process.env.ACCEPT_PUBLIC_REQUESTS?.trim().toLowerCase() === "true";

const runtime = new WorkerRuntime({
  workerId,
  configuredCapabilities: provider.capabilities,
  initialCapabilities: provider.capabilities,
  acceptPublicRequests,
  cycle: ({ capabilities, acceptPublicRequests: acceptsPublic, onEvent }) => runWorkerOnce({
    apiUrl,
    workerId,
    workerToken,
    capabilities,
    acceptPublicRequests: acceptsPublic,
    onEvent,
    execute: provider.execute
  })
});

const dashboard = await buildDashboardServer({ runtime, publicDir: resolve(process.cwd(), "public") });
const port = Number(process.env.DASHBOARD_PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("DASHBOARD_PORT must be a valid TCP port");
const url = await dashboard.listen(port, "127.0.0.1");
console.log(`Worker Command Center: ${url}`);
console.log("The dashboard is bound to loopback only. Provider credentials are never exposed to the browser.");
openBrowser(url);

if (process.env.WORKER_AUTO_START?.trim().toLowerCase() !== "false") runtime.start();

const shutdown = async () => {
  runtime.stop();
  await dashboard.close().catch(() => {});
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
