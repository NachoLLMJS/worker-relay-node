import { config as loadDotenv } from "dotenv";
import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { buildDashboardServer } from "./dashboard-server.js";
import { createDashboardConfigStore, type DashboardConfigSummary } from "./config-store.js";
import { buildWorkerExecutor } from "./provider-registry.js";
import { runWorkerOnce } from "./worker.js";
import { WorkerRuntime } from "./worker-runtime.js";
import { createCodexAuthController } from "./codex-auth.js";
import { boundedErrorMessage, installBoundedFatalErrorHandlers } from "./error-message.js";

installBoundedFatalErrorHandlers();

function openBrowser(url: string): void {
  if (process.env.DASHBOARD_AUTO_OPEN?.trim().toLowerCase() === "false" || process.argv.includes("--no-open")) return;
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

async function ensureEnvFile(envPath: string): Promise<void> {
  try {
    await access(envPath, constants.F_OK);
  } catch {
    await copyFile(resolve(process.cwd(), ".env.example"), envPath);
  }
}

function applySummary(runtime: WorkerRuntime, summary: DashboardConfigSummary): void {
  runtime.reconfigure({
    workerId: summary.workerId || "unenrolled-worker",
    configuredCapabilities: summary.workerCapabilities,
    activeCapabilities: summary.workerCapabilities,
    acceptPublicRequests: summary.acceptPublicRequests
  });
}

const envPath = resolve(process.cwd(), ".env");
await ensureEnvFile(envPath);
loadDotenv({ path: envPath, override: true });
const configStore = createDashboardConfigStore(envPath, { ...process.env });
let enrolledAtStartup = true;
await configStore.ensureWorkerIdentity().catch((error) => {
  enrolledAtStartup = false;
  console.error(boundedErrorMessage(error));
});
const initialSummary = await configStore.summary({ persistDetection: enrolledAtStartup });

const runtime = new WorkerRuntime({
  workerId: initialSummary.workerId || "unenrolled-worker",
  configuredCapabilities: initialSummary.workerCapabilities,
  initialCapabilities: initialSummary.workerCapabilities,
  acceptPublicRequests: initialSummary.acceptPublicRequests,
  detectCapabilities: async () => {
    await configStore.ensureWorkerIdentity();
    const summary = await configStore.summary();
    applySummary(runtime, summary);
    return summary.workerCapabilities;
  },
  cycle: async ({ acceptPublicRequests: acceptsPublic, onEvent }) => {
    await configStore.ensureWorkerIdentity();
    const workerToken = process.env.WORKER_ACCESS_TOKEN?.trim();
    if (!workerToken) throw new Error("Automatic worker enrollment did not provide an identity token.");
    const apiUrl = process.env.COORDINATOR_URL?.trim() || "https://api-production-cc9f.up.railway.app";
    const workerId = process.env.WORKER_ID?.trim() || initialSummary.workerId;
    if (!workerId) throw new Error("Automatic worker enrollment did not provide a worker ID.");
    process.env.ACCEPT_PUBLIC_REQUESTS = acceptsPublic ? "true" : "false";
    const provider = await buildWorkerExecutor(process.env);
    return runWorkerOnce({
      apiUrl,
      workerId,
      workerToken,
      capabilities: provider.capabilities,
      acceptPublicRequests: acceptsPublic,
      onEvent,
      execute: provider.execute
    });
  }
});

const dashboard = await buildDashboardServer({
  runtime,
  publicDir: resolve(process.cwd(), "public"),
  configStore,
  codexAuth: createCodexAuthController(),
  onConfigSaved: applySummary.bind(null, runtime)
});
const port = Number(process.env.DASHBOARD_PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("DASHBOARD_PORT must be a valid TCP port");
const url = await dashboard.listen(port, "127.0.0.1");
console.log(`Worker Command Center: ${url}`);
console.log("The dashboard is bound to loopback only. Worker identity is enrolled automatically; provider secrets are never exposed back to the browser.");
openBrowser(url);

if (process.env.WORKER_AUTO_START?.trim().toLowerCase() !== "false") {
  await runtime.start().catch((error) => console.error(boundedErrorMessage(error)));
}

const shutdown = async () => {
  runtime.stop();
  await dashboard.close().catch(() => {});
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
