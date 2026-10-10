import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { WorkerRuntime } from "../src/worker-runtime.js";
import { buildDashboardServer } from "../src/dashboard-server.js";
import { createDashboardConfigStore, windowsAclIsOwnerOnly } from "../src/config-store.js";
import { boundedErrorMessage } from "../src/error-message.js";

const root = join(import.meta.dirname, "..");

describe("local worker runtime", () => {
  it("bounds exception text before it reaches logs or stderr", () => {
    expect(boundedErrorMessage(new Error(`external-${"x".repeat(10_000)}`))).toHaveLength(500);
    expect(boundedErrorMessage("short failure")).toBe("short failure");
  });

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

  it("re-detects capabilities before start and fails closed when none are ready", async () => {
    const detected = vi.fn(async () => ["text.openai.codex"]);
    const runtime = new WorkerRuntime({
      workerId: "worker-local",
      configuredCapabilities: [],
      initialCapabilities: [],
      acceptPublicRequests: false,
      cycle: async () => "idle",
      detectCapabilities: detected,
      sleep: () => new Promise<void>(() => {})
    });
    await runtime.start();
    await vi.waitFor(() => expect(detected).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runtime.snapshot().activeCapabilities).toEqual(["text.openai.codex"]));
    runtime.stop();

    const unavailable = new WorkerRuntime({
      workerId: "worker-local",
      configuredCapabilities: [],
      initialCapabilities: [],
      acceptPublicRequests: false,
      cycle: async () => "idle",
      detectCapabilities: async () => []
    });
    await unavailable.start();
    await vi.waitFor(() => expect(unavailable.snapshot().failedCycles).toBeGreaterThan(0));
    expect(unavailable.snapshot()).toMatchObject({ running: true, connected: false, completedJobs: 0 });
    unavailable.stop();
  });

  it("keeps polling and retries enrollment/capability detection after a transient startup failure", async () => {
    let releaseSleep = () => {};
    const detected = vi.fn()
      .mockRejectedValueOnce(new Error("worker enrollment failed (503)"))
      .mockResolvedValue(["text.ollama"]);
    const cycle = vi.fn(async () => "idle" as const);
    const runtime = new WorkerRuntime({
      workerId: "unenrolled-worker", configuredCapabilities: [], initialCapabilities: [],
      acceptPublicRequests: true, detectCapabilities: detected, cycle,
      sleep: () => new Promise<void>((resolve) => { releaseSleep = resolve; })
    });
    await runtime.start();
    await vi.waitFor(() => expect(runtime.snapshot().failedCycles).toBe(1));
    releaseSleep();
    await vi.waitFor(() => expect(cycle).toHaveBeenCalledOnce());
    expect(detected).toHaveBeenCalledTimes(2);
    runtime.stop();
    releaseSleep();
  });

  it("bounds external error messages retained in dashboard logs", async () => {
    let releaseSleep = () => {};
    const runtime = new WorkerRuntime({
      workerId: "worker-local", configuredCapabilities: ["text.ollama"], initialCapabilities: ["text.ollama"],
      acceptPublicRequests: true, cycle: async () => { throw new Error(`external-${"x".repeat(10_000)}`); },
      sleep: () => new Promise<void>((resolve) => { releaseSleep = resolve; })
    });
    await runtime.start();
    await vi.waitFor(() => expect(runtime.snapshot().failedCycles).toBe(1));
    expect(runtime.snapshot().logs[0].message.length).toBeLessThanOrEqual(500);
    runtime.stop();
    releaseSleep();
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
  it("accepts only a single full-control Windows ACL for the current user", () => {
    const path = "C:\\Users\\operator\\worker\\.env";
    const acl = (...lines: string[]) => lines.join("\n");
    expect(windowsAclIsOwnerOnly(acl(`${path} OPERATOR\\alice:(F)`, "Successfully processed 1 files"), path, "OPERATOR\\alice")).toBe(true);
    expect(windowsAclIsOwnerOnly(acl(`${path} OTHER\\alice:(F)`, "Successfully processed 1 files"), path, "OPERATOR\\alice")).toBe(false);
    expect(windowsAclIsOwnerOnly(acl(`${path} OPERATOR\\alice:(F)`, "  BUILTIN\\Users:(R)", "Successfully processed 1 files"), path, "OPERATOR\\alice")).toBe(false);
    expect(windowsAclIsOwnerOnly(acl(`${path} OPERATOR\\alice:(R)`, "Successfully processed 1 files"), path, "OPERATOR\\alice")).toBe(false);
  });

  it("automatically enrolls an open worker identity and persists it without a pre-issued code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-enroll-"));
    const envFile = join(dir, ".env");
    await writeFile(envFile, "COORDINATOR_URL=https://network.example\nWORKER_NAME=Amigo 3\nWORKER_ID=\nWORKER_ACCESS_TOKEN=\n", "utf8");
    const enroll = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://network.example/api/workers/enroll");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Amigo 3" });
      return new Response(JSON.stringify({
        name: "Amigo 3",
        workerId: "amigo-3-a1b2c3d4e5",
        workerToken: `bncw_${"a".repeat(43)}`
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    const store = createDashboardConfigStore(envFile, {}, {
      detector: async () => ({ capabilities: [], envUpdates: { WORKER_CAPABILITIES: "" }, services: [] }),
      fetcher: enroll
    });
    try {
      const identity = await store.ensureWorkerIdentity();
      expect(identity).toEqual({ workerId: "amigo-3-a1b2c3d4e5", workerTokenSet: true });
      expect(enroll).toHaveBeenCalledOnce();
      const written = await readFile(envFile, "utf8");
      expect(written).toContain("WORKER_ID=amigo-3-a1b2c3d4e5");
      expect(written).toContain(`WORKER_ACCESS_TOKEN=bncw_${"a".repeat(43)}`);
      expect((await store.summary()).workerId).toBe("amigo-3-a1b2c3d4e5");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("re-enrolls when a saved worker identity no longer verifies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-reenroll-"));
    const envFile = join(dir, ".env");
    await writeFile(envFile, `COORDINATOR_URL=https://network.example\nWORKER_NAME=Amigo 3\nWORKER_ID=old-worker-id\nWORKER_ACCESS_TOKEN=bncw_${"x".repeat(43)}\n`, "utf8");
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/api/workers/verify")) return new Response(null, { status: 401 });
      return new Response(JSON.stringify({
        workerId: "amigo-3-freshidentity",
        workerToken: `bncw_${"b".repeat(43)}`
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    const store = createDashboardConfigStore(envFile, {}, {
      detector: async () => ({ capabilities: [], envUpdates: { WORKER_CAPABILITIES: "" }, services: [] }),
      fetcher
    });
    try {
      expect(await store.ensureWorkerIdentity()).toEqual({ workerId: "amigo-3-freshidentity", workerTokenSet: true });
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        "https://network.example/api/workers/verify",
        "https://network.example/api/workers/enroll"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe coordinator URLs before sending a saved worker token", async () => {
    for (const coordinatorUrl of [
      "http://network.example",
      "https://user:pass@network.example",
      "https://network.example?redirect=evil",
      "https://network.example/#fragment",
      "https://network.example?",
      "https://network.example/#"
    ]) {
      const dir = await mkdtemp(join(tmpdir(), "worker-relay-insecure-coordinator-"));
      const envFile = join(dir, ".env");
      await writeFile(envFile, `COORDINATOR_URL=${coordinatorUrl}\nWORKER_NAME=Amigo 3\nWORKER_ID=old-worker-id\nWORKER_ACCESS_TOKEN=bncw_${"x".repeat(43)}\n`, "utf8");
      const fetcher = vi.fn();
      const store = createDashboardConfigStore(envFile, {}, {
        detector: async () => ({ capabilities: [], envUpdates: { WORKER_CAPABILITIES: "" }, services: [] }),
        fetcher
      });
      try {
        await expect(store.ensureWorkerIdentity()).rejects.toThrow("Coordinator URL");
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("never combines a partial file identity with a stale process identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-identity-source-"));
    const envFile = join(dir, ".env");
    await writeFile(envFile, "COORDINATOR_URL=https://network.example\nWORKER_NAME=Amigo 3\nWORKER_ID=file-worker-id\n", "utf8");
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe("https://network.example/api/workers/enroll");
      return new Response(JSON.stringify({ workerId: "fresh-worker-id", workerToken: `bncw_${"b".repeat(43)}` }), {
        status: 201, headers: { "content-type": "application/json" }
      });
    });
    const store = createDashboardConfigStore(envFile, {
      WORKER_ID: "stale-process-id", WORKER_ACCESS_TOKEN: `bncw_${"x".repeat(43)}`
    }, {
      detector: async () => ({ capabilities: [], envUpdates: { WORKER_CAPABILITIES: "" }, services: [] }), fetcher
    });
    try {
      expect(await store.ensureWorkerIdentity()).toEqual({ workerId: "fresh-worker-id", workerTokenSet: true });
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not rewrite configuration while enrollment is still pending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-pending-enrollment-"));
    const envFile = join(dir, ".env");
    const original = "COORDINATOR_URL=https://network.example\nWORKER_NAME=Amigo 3\nWORKER_ID=\nWORKER_ACCESS_TOKEN=\n";
    await writeFile(envFile, original, "utf8");
    const store = createDashboardConfigStore(envFile, {}, {
      detector: async () => ({ capabilities: [], envUpdates: { WORKER_CAPABILITIES: "" }, services: [] })
    });
    try {
      expect((await store.summary({ persistDetection: false })).workerId).toBe("");
      expect(await readFile(envFile, "utf8")).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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

  it("does not return arbitrary internal error messages through the dashboard API", async () => {
    const runtime = new WorkerRuntime({
      workerId: "worker-local", configuredCapabilities: ["text.ollama"], initialCapabilities: ["text.ollama"],
      acceptPublicRequests: false, cycle: async () => "idle"
    });
    const server = await buildDashboardServer({
      runtime,
      publicDir: join(root, "public"),
      configStore: {
        summary: async () => ({ workerId: "worker-local" } as never),
        save: async () => { throw new Error(`internal-${"secret".repeat(100)}`); }
      }
    });
    const address = await server.listen(0, "127.0.0.1");
    try {
      const response = await fetch(`${address}/api/config`, {
        method: "POST",
        headers: { "x-dashboard-token": server.token, origin: address, "content-type": "application/json" },
        body: JSON.stringify({ workerName: "safe" })
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
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
    await writeFile(envFile, `COORDINATOR_URL=https://api-production-cc9f.up.railway.app\nWORKER_ID=auto-worker-id\nWORKER_ACCESS_TOKEN=bncw_${"z".repeat(43)}\nWORKER_NAME=Friendly worker\nWORKER_CAPABILITIES=text.ollama\nACCEPT_PUBLIC_REQUESTS=false\nSUBSCRIPTION_CLI_ENABLED=false\nCODEX_COMMAND=codex\nOPENAI_API_KEY=\n`, "utf8");
    const runtime = new WorkerRuntime({
      workerId: "friend-worker-1",
      configuredCapabilities: ["text.ollama"],
      initialCapabilities: ["text.ollama"],
      acceptPublicRequests: false,
      cycle: async () => "idle"
    });
    const store = createDashboardConfigStore(envFile, { ...process.env }, {
      detector: async (env) => {
        const capabilities = env?.SUBSCRIPTION_CLI_ENABLED === "true" ? ["text.openai.codex"] : [];
        return { capabilities, envUpdates: { WORKER_CAPABILITIES: capabilities.join(",") }, services: [] };
      }
    });
    const server = await buildDashboardServer({
      runtime,
      publicDir: join(root, "public"),
      configStore: store,
      onConfigSaved: (summary) => {
        runtime.reconfigure({
          workerId: summary.workerId,
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
          workerName: "nacho-wsl-worker",
          subscriptionCliEnabled: true,
          codexCommand: "/home/operator/.hermes/node/bin/codex",
          codexModel: "gpt-5.1-codex",
          openaiApiKey: "test-openai-placeholder",
          acceptPublicRequests: true
        })
      }).then((response) => response.json());

      expect(saved.workerAccessTokenSet).toBe(true);
      expect(saved.openaiApiKeySet).toBe(true);
      expect(JSON.stringify(saved)).not.toContain("secret-worker-token");
      expect(JSON.stringify(saved)).not.toContain("test-openai-placeholder");
      expect(runtime.snapshot()).toMatchObject({ workerId: "auto-worker-id", acceptPublicRequests: true });
      expect(runtime.snapshot().activeCapabilities).toEqual(["text.openai.codex"]);
      const written = await readFile(envFile, "utf8");
      expect(written).toContain(`WORKER_ACCESS_TOKEN=bncw_${"z".repeat(43)}`);
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

  it("keeps the detected capability list empty when no provider is ready", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-config-"));
    const envFile = join(dir, ".env");
    await writeFile(envFile, "WORKER_CAPABILITIES=text.ollama\n", "utf8");
    const store = createDashboardConfigStore(envFile, {}, {
      detector: async () => ({ capabilities: [], envUpdates: { WORKER_CAPABILITIES: "" }, services: [] })
    });
    try {
      expect((await store.summary()).workerCapabilities).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists automatically detected capabilities and does not accept operator-selected capabilities", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-relay-config-"));
    const envFile = join(dir, ".env");
    await writeFile(envFile, "OLLAMA_MODEL=missing\nWORKER_CAPABILITIES=legacy.manual\n", "utf8");
    const detector = vi.fn(async () => ({
      capabilities: ["text.ollama", "text.openai.sol"],
      envUpdates: { OLLAMA_MODEL: "qwen3:8b", WORKER_CAPABILITIES: "text.ollama,text.openai.sol" },
      services: []
    }));
    const store = createDashboardConfigStore(envFile, {}, { detector });
    try {
      const summary = await store.summary();
      expect(summary.workerCapabilities).toEqual(["text.ollama", "text.openai.sol"]);
      expect(summary.ollamaModel).toBe("qwen3:8b");
      expect(await readFile(envFile, "utf8")).toContain("WORKER_CAPABILITIES=text.ollama,text.openai.sol");
      await expect(store.save({ workerCapabilities: ["text.ollama"] } as never)).rejects.toThrow("unsupported configuration field");
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
    expect(html).toContain('id="cfg-worker-id"');
    expect(html).not.toContain('id="cfg-worker-token"');
    expect(css).toContain("--hermes-bg");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("ethereum.request");
    expect(source).not.toContain('request("/api/worker/capabilities"');
    expect(source).not.toContain("workerCapabilities:");
    expect(source).not.toContain('checkbox.dataset.capability');
    expect(source).not.toContain('updateCapabilities');
    expect(source).not.toContain('request("/api/worker/public-requests"');
    expect(source).toContain('request("/api/codex/login"');
    const renderStatusBody = source.slice(source.indexOf("function renderStatus"), source.indexOf("async function refresh"));
    expect(renderStatusBody).not.toContain("renderConfig();");
  });
});
