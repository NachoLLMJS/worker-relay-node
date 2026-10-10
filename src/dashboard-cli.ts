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

function parseCapabilities(value: string | undefined): string[] {
  const parsed = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return parsed.length ? [...new Set(parsed)] : ["text.ollama"];
}

function applySummary(runtime: WorkerRuntime, summary: DashboardConfigSummary): void {
  runtime.reconfigure({
    workerId: summary.workerName,
    configuredCapabilities: summary.workerCapabilities,
    activeCapabilities: summary.workerCapabilities,
    acceptPublicRequests: summary.acceptPublicRequests
  });
}

const envPath = resolve(process.cwd(), ".env");
await ensureEnvFile(envPath);
loadDotenv({ path: envPath, override: true });
const configStore = createDashboardConfigStore(envPath, { ...process.env });
const initialSummary = await configStore.summary();

const runtime = new WorkerRuntime({
  workerId: initialSummary.workerName,
  configuredCapabilities: initialSummary.workerCapabilities,
  initialCapabilities: initialSummary.workerCapabilities,
  acceptPublicRequests: initialSummary.acceptPublicRequests,
  cycle: ({ capabilities, acceptPublicRequests: acceptsPublic, onEvent }) => {
    const workerToken = process.env.WORKER_ACCESS_TOKEN?.trim();
    if (!workerToken) throw new Error("WORKER_ACCESS_TOKEN is missing. Open Configuration in the dashboard and save the worker token.");
    const apiUrl = process.env.COORDINATOR_URL?.trim() || "https://api-production-cc9f.up.railway.app";
    const workerId = process.env.WORKER_NAME?.trim() || initialSummary.workerName;
    process.env.WORKER_CAPABILITIES = capabilities.join(",");
    process.env.ACCEPT_PUBLIC_REQUESTS = acceptsPublic ? "true" : "false";
    const provider = buildWorkerExecutor(process.env);
    return runWorkerOnce({
      apiUrl,
      workerId,
      workerToken,
      capabilities,
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
console.log("The dashboard is bound to loopback only. Configure tokens/API keys locally under Configuration; secrets are never exposed back to the browser.");
openBrowser(url);

if (process.env.WORKER_AUTO_START?.trim().toLowerCase() !== "false" && initialSummary.workerAccessTokenSet) runtime.start();
else if (!initialSummary.workerAccessTokenSet) console.log("Worker is not polling yet: open Configuration and save WORKER_ACCESS_TOKEN, then click Start worker.");

const shutdown = async () => {
  runtime.stop();
  await dashboard.close().catch(() => {});
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
