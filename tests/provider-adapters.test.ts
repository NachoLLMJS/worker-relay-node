import { describe, expect, it, vi } from "vitest";
import { generateWithAnthropic } from "../src/anthropic-adapter.js";
import { generateWithDeepSeek } from "../src/deepseek-adapter.js";
import { generateWithHiggsfield } from "../src/higgsfield-adapter.js";
import { generateWithOpenAI } from "../src/openai-adapter.js";
import { buildWorkerExecutor, executeSelectedServices } from "../src/provider-registry.js";
import { generateWithCodexSubscription, resolveSubscriptionCliInvocation, subscriptionCliEnvironment, subscriptionCliFailureMessage, subscriptionCliIsLoggedIn } from "../src/subscription-cli-adapter.js";

describe("hosted text adapters", () => {
  it("calls the OpenAI Responses API and returns output text", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer openai-key" });
      expect(JSON.parse(String(init?.body))).toEqual({ model: "openai-sol-2026-07-20", input: "hello" });
      return new Response(JSON.stringify({ output_text: "Hello from Sol" }), { status: 200 });
    });
    await expect(generateWithOpenAI({ apiKey: "openai-key", model: "openai-sol-2026-07-20", prompt: "hello", fetcher })).resolves.toBe("Hello from Sol");
  });

  it("calls the OpenAI Images API and returns a generated image data URL", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/images/generations");
      expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-image-2", prompt: "global AI network", size: "1536x1024", output_format: "webp", output_compression: 85 });
      return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), { status: 200 });
    });
    await expect(generateWithOpenAI({ apiKey: "openai-key", model: "gpt-image-2", prompt: "global AI network", kind: "image", fetcher })).resolves.toBe("data:image/webp;base64,aW1hZ2U=");
  });

  it("calls Anthropic Messages and returns Fable text", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "claude-fable-5", messages: [{ role: "user", content: "dialogue" }] });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Fable result" }] }), { status: 200 });
    });
    await expect(generateWithAnthropic({ apiKey: "anthropic-key", model: "claude-fable-5", prompt: "dialogue", fetcher })).resolves.toBe("Fable result");
  });

  it("calls DeepSeek Chat Completions and returns model text", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepseek.com/chat/completions");
      expect(init?.headers).toMatchObject({ authorization: "Bearer deepseek-key" });
      expect(JSON.parse(String(init?.body))).toEqual({ model: "deepseek-v4-pro", messages: [{ role: "user", content: "hello" }], stream: false });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello from DeepSeek" } }] }), { status: 200 });
    });
    await expect(generateWithDeepSeek({ apiKey: "deepseek-key", model: "deepseek-v4-pro", prompt: "hello", fetcher })).resolves.toBe("Hello from DeepSeek");
  });
});

describe("Higgsfield adapter", () => {
  it("uses the CLI without a shell and returns a generated media URL", async () => {
    const runner = vi.fn(async (_command: string, args: string[], env: NodeJS.ProcessEnv) => {
      expect(args).toEqual(expect.arrayContaining(["generate", "create", "seedance_2_5", "--prompt", "moon city", "--wait", "--json"]));
      expect(env.WORKER_ACCESS_TOKEN).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      return JSON.stringify([{ outputs: [{ url: "https://cdn.example/video.mp4" }] }]);
    });
    await expect(generateWithHiggsfield({ modelId: "seedance_2_5", prompt: "moon city", args: ["--mode", "t2v"], sourceEnv: { PATH: "test-path", WORKER_ACCESS_TOKEN: "secret", OPENAI_API_KEY: "secret" }, runner })).resolves.toBe("https://cdn.example/video.mp4");
  });
});

describe("subscription CLI adapters", () => {
  it("reports a Codex JSONL failure without echoing the submitted request", () => {
    const privatePrompt = "request text must stay private";
    const message = subscriptionCliFailureMessage(1, null,
      `{"type":"turn.failed","error":{"message":"model is unavailable: ${privatePrompt}"}}`,
      `failed while processing ${privatePrompt}`,
      [privatePrompt]);
    expect(message).toContain("exit=1");
    expect(message).toContain("kind=model_unavailable");
    expect(message).not.toContain(privatePrompt);
  });

  it("redacts reformatted prompt fragments from stderr diagnostics", () => {
    const message = subscriptionCliFailureMessage(1, null, "", "request alpha failed", ["private alpha request"]);
    expect(message).toContain("exit=1");
    expect(message).not.toContain("alpha");
    expect(message).not.toContain("request");
  });

  it("does not emit diagnostic text when the submitted request is too short to redact safely", () => {
    const message = subscriptionCliFailureMessage(1, null,
      '{"type":"turn.failed","error":{"message":"failed for: hi"}}', "prompt hi failed", ["hi"]);
    expect(message).toContain("exit=1");
    expect(message).not.toContain("failed for");
    expect(message).not.toContain("prompt hi");
  });

  it("bounds failure diagnostics, includes termination signals and redacts credential shapes", () => {
    const message = subscriptionCliFailureMessage(null, "SIGTERM",
      '{"type":"turn.failed","error":{"message":"Bearer top-secret"}}',
      `bncw_${"a".repeat(43)} sk-${"b".repeat(30)} ${"x".repeat(1_000)}`);
    expect(message).toContain("exit=null");
    expect(message).toContain("signal=SIGTERM");
    expect(message).not.toContain(`bncw_${"a".repeat(43)}`);
    expect(message).not.toContain(`sk-${"b".repeat(30)}`);
    expect(message).not.toContain("top-secret");
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it("sanitizes Codex error events even when the CLI exits successfully", async () => {
    const privatePrompt = "private prompt must never appear";
    const runner = vi.fn(async () =>
      `{"type":"item.completed","item":{"type":"error","message":"model is unavailable: ${privatePrompt} Bearer hidden"}}\n`);
    try {
      await generateWithCodexSubscription({ prompt: privatePrompt, runner });
      throw new Error("expected Codex failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("kind=model_unavailable");
      expect(message).not.toContain(privatePrompt);
      expect(message).not.toContain("hidden");
    }
  });

  it("accepts Codex login status when the CLI writes it to stderr", () => {
    expect(subscriptionCliIsLoggedIn("codex", "", "Logged in using ChatGPT\n")).toBe(true);
  });

  it("preserves a custom npm prefix for portable Codex discovery", () => {
    expect(subscriptionCliEnvironment({ NPM_CONFIG_PREFIX: "/opt/npm-user" })).toEqual({
      NPM_CONFIG_PREFIX: "/opt/npm-user"
    });
  });

  it("detects Codex from npm's lowercase prefix environment on Linux", () => {
    const env = subscriptionCliEnvironment({
      PATH: "/usr/bin:/bin",
      HOME: "/home/worker",
      npm_config_prefix: "/home/worker/.npm-packages"
    });
    const invocation = resolveSubscriptionCliInvocation("codex", env, "linux", () => false, (path) => path === "/home/worker/.npm-packages/bin/codex");

    expect(invocation.command).toBe("/home/worker/.npm-packages/bin/codex");
  });

  it("detects Codex under a custom npm prefix", () => {
    const invocation = resolveSubscriptionCliInvocation("codex", {
      PATH: "/usr/bin:/bin",
      HOME: "/home/worker",
      NPM_CONFIG_PREFIX: "/opt/npm-user"
    }, "linux", () => false, (path) => path === "/opt/npm-user/bin/codex");

    expect(invocation).toEqual({
      command: "/opt/npm-user/bin/codex",
      argsPrefix: []
    });
  });

  it("detects a Hermes-managed Codex install on Linux when it is missing from the dashboard PATH", () => {
    const invocation = resolveSubscriptionCliInvocation("codex", {
      PATH: "/usr/bin:/bin",
      HOME: "/home/operator"
    }, "linux", () => false, (path) => path === "/home/operator/.hermes/node/bin/codex");

    expect(invocation).toEqual({
      command: "/home/operator/.hermes/node/bin/codex",
      argsPrefix: []
    });
  });

  it("detects Codex beside the Node executable used to launch the dashboard", () => {
    const invocation = resolveSubscriptionCliInvocation("codex", {
      PATH: "/usr/bin:/bin",
      HOME: "/home/worker"
    }, "linux", () => false, (path) => path === "/opt/hermes-runtime/bin/codex", "/opt/hermes-runtime/bin/node");

    expect(invocation.command).toBe("/opt/hermes-runtime/bin/codex");
  });

  it("detects a Hermes-managed Codex install on Windows outside PATH", () => {
    const invocation = resolveSubscriptionCliInvocation("codex", {
      PATH: "C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\worker"
    }, "win32", (path) => path === "C:\\Users\\worker\\.hermes\\node\\bin\\codex.exe");

    expect(invocation).toEqual({ command: "C:\\Users\\worker\\.hermes\\node\\bin\\codex.exe", argsPrefix: [] });
  });

  it("resolves the Windows npm Codex shim to its JavaScript launcher without a shell", () => {
    const pathDirectory = "C:\\Users\\worker\\AppData\\Roaming\\npm";
    const invocation = resolveSubscriptionCliInvocation("codex", {
      PATH: pathDirectory,
      PATHEXT: ".COM;.EXE;.BAT;.CMD"
    }, "win32", (path) => path === `${pathDirectory}\\codex.cmd` || path === `${pathDirectory}\\node_modules\\@openai\\codex\\bin\\codex.js`);

    expect(invocation).toEqual({
      command: process.execPath,
      argsPrefix: [`${pathDirectory}\\node_modules\\@openai\\codex\\bin\\codex.js`]
    });
  });

  it("resolves an explicit current-directory Windows Codex shim without searching PATH", () => {
    const invocation = resolveSubscriptionCliInvocation(".\\codex.cmd", {
      PATH: "C:\\unrelated"
    }, "win32", (path) => path === ".\\codex.cmd" || path === "node_modules\\@openai\\codex\\bin\\codex.js");

    expect(invocation).toEqual({
      command: process.execPath,
      argsPrefix: ["node_modules\\@openai\\codex\\bin\\codex.js"]
    });
  });

  it("runs Codex in an ephemeral text-only sandbox and parses its final message", async () => {
    const runner = vi.fn(async (input: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdin: string }) => {
      expect(input.command).toBe("codex-test");
      expect(input.args).toEqual(expect.arrayContaining([
        "exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--ephemeral",
        "--sandbox", "read-only", "--disable", "shell_tool", "--json"
      ]));
      expect(input.args.at(-1)).toBe("-");
      expect(input.args).not.toContain("review this function");
      expect(input.stdin).toContain("review this function");
      expect(input.env.WORKER_ACCESS_TOKEN).toBeUndefined();
      expect(input.env.OPENAI_API_KEY).toBeUndefined();
      return '{"type":"item.completed","item":{"type":"agent_message","text":"Codex subscription result"}}\n';
    });
    await expect(generateWithCodexSubscription({
      command: "codex-test",
      prompt: "review this function",
      sourceEnv: { PATH: "test-path", HOME: "test-home", WORKER_ACCESS_TOKEN: "secret", OPENAI_API_KEY: "secret" },
      runner
    })).resolves.toBe("Codex subscription result");
  });
});

describe("worker provider registry", () => {
  const unavailableOllama = vi.fn(async () => new Response("unavailable", { status: 503 }));
  const authenticatedHostedProviders = vi.fn(async (url: string) => url.includes("127.0.0.1:11434")
    ? new Response("unavailable", { status: 503 })
    : new Response(JSON.stringify({ data: [] }), { status: 200 }));

  it("auto-detects configured hosted providers and ignores the legacy capability allowlist", async () => {
    const worker = await buildWorkerExecutor({
      WORKER_CAPABILITIES: "text.ollama",
      ANTHROPIC_API_KEY: "configured",
      DEEPSEEK_API_KEY: "configured"
    }, { fetcher: authenticatedHostedProviders });
    expect(worker.capabilities).toEqual(["text.anthropic.fable", "text.deepseek.flash", "text.deepseek.v4-pro"]);
  });

  it("fails closed when no provider is currently ready", async () => {
    await expect(buildWorkerExecutor({}, { fetcher: unavailableOllama })).rejects.toThrow("no provider capabilities are currently ready");
  });

  it("requires subscription CLI opt-in and verifies local login before advertising Codex", async () => {
    const disabledProbe = vi.fn();
    await expect(buildWorkerExecutor({}, { fetcher: unavailableOllama, subscriptionProbe: disabledProbe })).rejects.toThrow("no provider capabilities");
    expect(disabledProbe).not.toHaveBeenCalled();

    const probe = vi.fn();
    const worker = await buildWorkerExecutor({
      SUBSCRIPTION_CLI_ENABLED: "true",
      CODEX_COMMAND: "codex-test"
    }, { fetcher: unavailableOllama, subscriptionProbe: probe });
    expect(probe).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledWith("codex", "codex-test", expect.any(Object));
    expect(worker.capabilities).toEqual(["text.openai.codex"]);
  });

  it("returns single-service output unchanged and composite JSON for combined service requirements", async () => {
    const run = vi.fn(async (serviceId: string) => `result:${serviceId}`);
    await expect(executeSelectedServices({ id: "one", prompt: "hello", serviceId: "text.openai.sol" }, run)).resolves.toBe("result:text.openai.sol");
    const composite = await executeSelectedServices({
      id: "many",
      prompt: "hello",
      serviceId: "text.openai.sol",
      serviceIds: ["text.openai.sol", "text.anthropic.fable"]
    }, run);
    expect(JSON.parse(composite)).toEqual({
      services: [
        { serviceId: "text.openai.sol", output: "result:text.openai.sol" },
        { serviceId: "text.anthropic.fable", output: "result:text.anthropic.fable" }
      ]
    });
  });

  it("attempts every selected service even when one combined execution fails", async () => {
    const run = vi.fn(async (serviceId: string) => {
      if (serviceId === "text.openai.sol") throw new Error("provider failed");
      return "anthropic result";
    });
    await expect(executeSelectedServices({
      id: "many",
      prompt: "hello",
      serviceId: "text.openai.sol",
      serviceIds: ["text.openai.sol", "text.anthropic.fable"]
    }, run)).rejects.toThrow("provider failed");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rejects the retired Claude Code subscription capability", async () => {
    const worker = await buildWorkerExecutor({ OPENAI_API_KEY: "configured" }, { fetcher: authenticatedHostedProviders });
    await expect(worker.execute({ id: "job", prompt: "hello", serviceId: "text.anthropic.claude-code" })).rejects.toThrow("unapproved service");
  });
});
