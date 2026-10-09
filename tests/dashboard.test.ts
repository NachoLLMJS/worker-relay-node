import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkerRuntime } from "../src/worker-runtime.js";
import { buildDashboardServer } from "../src/dashboard-server.js";

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
      const accepted = await fetch(`${address}/api/worker/start`, { method: "POST", headers: { "x-dashboard-token": server.token } });
      expect(accepted.status).toBe(200);
      runtime.stop();
    } finally {
      await server.close();
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
    expect(css).toContain("--hermes-bg");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("ethereum.request");
  });
});
