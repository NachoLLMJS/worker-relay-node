import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { WorkerRuntime } from "../src/worker-runtime.js";
import { buildDashboardServer } from "../src/dashboard-server.js";
import { createDashboardConfigStore } from "../src/config-store.js";

const root = join(import.meta.dirname, "..");

describe("local worker runtime", () => {
  it("starts, reports connectivity, records completed jobs, and stops without exposing secrets", async () => {
    let releaseSleep = () => {};
    const cycle = vi.fn(async ({ capabilities, onEvent }: { capabilities: string[]; onEvent: (event: import("../src/worker-runtime.js").WorkerCycleEvent) => void }) => {
      expect(capabilities).toEqual(["text.ollama"]);
      onEvent({ type: "claimed", job: { id: "job-1", prompt: "say hello", serviceId: "text.ollama" } });
      onEvent({ type: "completed", job: { id: "job-1", prompt: "say hello", serviceId: "text.ollama" }, output: "hello" });
      return "completed" as const;
    });
    const runtime = new WorkerRuntime({
      workerId: "worker-local",
      configuredCapabilities: ["text.ollama", "text.openai.codex"],
      initialCapabilities: ["text.ollama"],
      acceptPublicRequests: true,
      cycle,
      sleep: () => new Promise<void>((resolve) => { releaseSleep = resolve; })
    });

    runtime.start();
    await vi.waitFor(() => expect(runtime.snapshot().completedJobs).toBe(1));
    expect(runtime.snapshot()).toMatchObject({ running: true, connected: true, busy: false, acceptPublicRequests: true });
    expect(runtime.snapshot().recentJobs[0]).toMatchObject({ id: "job-1", state: "succeeded", output: "hello" });
    expect(JSON.stringify(runtime.snapshot())).not.toContain("worker-secret");
    runtime.stop();
    releaseSleep();
    await vi.waitFor(() => expect(runtime.snapshot().running).toBe(false));
  });

  it("can enable only capabilities validated at startup", () => {
    const runtime = new WorkerRuntime({
      workerId: "worker-local",
      configuredCapabilities: ["text.ollama", "text.openai.codex"],
      initialCapabilities: ["text.ollama"],
      acceptPublicRequests: false,
      cycle: async () => "idle"
    });
    runtime.setCapabilities(["text.openai.codex"]);
    expect(runtime.snapshot().activeCapabilities).toEqual(["text.openai.codex"]);
    expect(() => runtime.setCapabilities(["text.deepseek.flash"])).toThrow("capability was not validated at startup");
  });
});

describe("local dashboard server", () => {
  it("exposes protected Codex sign-in controls to the local dashboard", async () => {
    const runtime = new WorkerRuntime({
      workerId: "worker-local",
      configuredCapabilities: ["text.ollama"],
      initialCapabilities: ["text.ollama"],
      acceptPublicRequests: false,
      cycle: async () => "idle"
    });
    const startLogin = vi.fn(() => ({ state: "signing_in" as const, message: "Browser sign-in started" }));
    const options = {
      runtime,
      publicDir: join(root, "public"),
      codexAuth: {
        status: () => ({ state: "signed_out" as const, message: "Sign in required" }),
        startLogin
      }
    } as Parameters<typeof buildDashboardServer>[0];
    const server = await buildDashboardServer(options);
    const address = await server.listen(0, "127.0.0.1");
    try {
      const rejectedStatus = await fetch(`${address}/api/codex/status`);
      expect(rejectedStatus.status).toBe(403);
      const status = await fetch(`${address}/api/codex/status`, { headers: { "x-dashboard-token": server.token } }).then((response) => response.json());
      expect(status).toEqual({ state: "signed_out", message: "Sign in required" });

      const rejected = await fetch(`${address}/api/codex/login`, { method: "POST" });
      expect(rejected.status).toBe(403);
      const crossSite = await fetch(`${address}/api/codex/login`, { method: "POST", headers: { "x-dashboard-token": server.token, origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
      expect(crossSite.status).toBe(403);
      const accepted = await fetch(`${address}/api/codex/login`, { method: "POST", headers: { "x-dashboard-token": server.token, origin: address } });
      expect(accepted.status).toBe(202);
      expect(startLogin).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it("serves the Hermes-style control surface on loopback and protects state-changing routes", async () => {
    const runtime = new WorkerRuntime({
      workerId: "worker-local",
      configuredCapabilities: ["text.ollama"],
      initialCapabilities: ["text.ollama"],
      acceptPublicRequests: false,
      cycle: async () => "idle"
    });
    const server = await buildDashboardServer({ runtime, publicDir: join(root, "public") });
    const address = await server.listen(0, "127.0.0.1");
    try {
      const html = await fetch(`${address}/`).then((response) => response.text());
      expect(html).toContain("WORKER COMMAND CENTER");
      expect(html).toContain("Blockchain verification is not active");
      expect(html).not.toContain("Connect Wallet");

      const status = await fetch(`${address}/api/status`).then((response) => response.json());
      expect(status.workerId).toBe("worker-local");
      expect(status).not.toHaveProperty("workerToken");
      expect(status).not.toHaveProperty("apiKeys");

      const rejected = await fetch(`${address}/api/worker/start`, { method: "POST" });
      expect(rejected.status).toBe(403);
      const accepted = await fetch(`${address}/api/worker/start`, { method: "POST", headers: { "x-dashboard-token": server.token, origin: address } });
      expect(accepted.status).toBe(200);
      runtime.stop();
    } finally {
      await server.close();
    }
  });

  it("lets the dashboard save local configuration while redacting credential values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-config-"));
    const envFile = join(dir, ".env");
    await writeFile(envFile, "COORDINATOR_URL=https://api-production-cc9f.up.railway.app\nWORKER_ACCESS_TOKEN=\nWORKER_NAME=friend-worker-1\nWORKER_CAPABILITIES=text.ollama\nACCEPT_PUBLIC_REQUESTS=false\nSUBSCRIPTION_CLI_ENABLED=false\nCODEX_COMMAND=codex\nOPENAI_API_KEY=\n", "utf8");
    const runtime = new WorkerRuntime({
      workerId: "friend-worker-1",
      configuredCapabilities: ["text.ollama"],
      initialCapabilities: ["text.ollama"],
      acceptPublicRequests: false,
      cycle: async () => "idle"
    });
    const store = createDashboardConfigStore(envFile, { ...process.env });
    const server = await buildDashboardServer({
      runtime,
      publicDir: join(root, "public"),
      configStore: store,
      onConfigSaved: (summary) => {
        runtime.reconfigure({
          workerId: summary.workerName,
          configuredCapabilities: summary.workerCapabilities,
          activeCapabilities: summary.workerCapabilities,
          acceptPublicRequests: summary.acceptPublicRequests
        });
      }
    });
    const address = await server.listen(0, "127.0.0.1");
    try {
      const saved = await fetch(`${address}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-dashboard-token": server.token, origin: address },
        body: JSON.stringify({
          workerAccessToken: "secret-worker-token-1234567890",
          workerName: "nacho-wsl-worker",
          workerCapabilities: ["text.openai.codex"],
          subscriptionCliEnabled: true,
          codexCommand: "/home/nachete/.hermes/node/bin/codex",
          codexModel: "gpt-5.1-codex",
          openaiApiKey: "sk-test-secret",
          acceptPublicRequests: true
        })
      }).then((response) => response.json());

      expect(saved.workerAccessTokenSet).toBe(true);
      expect(saved.openaiApiKeySet).toBe(true);
      expect(JSON.stringify(saved)).not.toContain("secret-worker-token");
      expect(JSON.stringify(saved)).not.toContain("sk-test-secret");
      expect(runtime.snapshot()).toMatchObject({ workerId: "nacho-wsl-worker", acceptPublicRequests: true });
      expect(runtime.snapshot().activeCapabilities).toEqual(["text.openai.codex"]);
      const written = await readFile(envFile, "utf8");
      expect(written).toContain("WORKER_ACCESS_TOKEN=secret-worker-token-1234567890");
      expect(written).toContain("WORKER_CAPABILITIES=text.openai.codex");
      expect(written).toContain("SUBSCRIPTION_CLI_ENABLED=true");
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects multiline configuration values before writing the env file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-config-"));
    const envFile = join(dir, ".env");
    const original = "WORKER_NAME=friend-worker-1\nACCEPT_PUBLIC_REQUESTS=false\n";
    await writeFile(envFile, original, "utf8");
    const store = createDashboardConfigStore(envFile, {});
    try {
      await expect(store.save({ workerName: "friend-worker\nACCEPT_PUBLIC_REQUESTS=true" })).rejects.toThrow("workerName");
      expect(await readFile(envFile, "utf8")).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown configuration fields before writing the env file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-config-"));
    const envFile = join(dir, ".env");
    const original = "WORKER_NAME=friend-worker-1\n";
    await writeFile(envFile, original, "utf8");
    const store = createDashboardConfigStore(envFile, {});
    try {
      await expect(store.save({ unexpectedField: "value" } as never)).rejects.toThrow("unsupported configuration field");
      expect(await readFile(envFile, "utf8")).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ships a local UI without unsafe dynamic HTML or persistent browser storage", async () => {
    const [html, css, source] = await Promise.all([
      readFile(join(root, "public", "index.html"), "utf8"),
      readFile(join(root, "public", "styles.css"), "utf8"),
      readFile(join(root, "public", "app.js"), "utf8")
    ]);
    expect(html).toContain('id="terminal-feed"');
    expect(html).toContain('id="models-grid"');
    expect(html).toContain('id="jobs-table"');
    expect(html).toContain('id="codex-login"');
    expect(html).toContain('id="codex-auth-status"');
    expect(css).toContain("--hermes-bg");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("ethereum.request");
    expect(source).not.toContain('request("/api/worker/capabilities"');
    expect(source).not.toContain('request("/api/worker/public-requests"');
    expect(source).toContain('request("/api/codex/login"');
    const renderStatusBody = source.slice(source.indexOf("function renderStatus"), source.indexOf("async function refresh"));
    expect(renderStatusBody).not.toContain("renderConfig();");
  });
});
