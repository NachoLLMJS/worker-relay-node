import { describe, expect, it, vi } from "vitest";
import { generateWithAnthropic } from "../src/anthropic-adapter.js";
import { generateWithDeepSeek } from "../src/deepseek-adapter.js";
import { generateWithHiggsfield } from "../src/higgsfield-adapter.js";
import { generateWithOpenAI } from "../src/openai-adapter.js";
import { buildWorkerExecutor } from "../src/provider-registry.js";
import { generateWithClaudeCodeSubscription, generateWithCodexSubscription, subscriptionCliIsLoggedIn } from "../src/subscription-cli-adapter.js";

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
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "claude-fable-4-6", messages: [{ role: "user", content: "dialogue" }] });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Fable result" }] }), { status: 200 });
    });
    await expect(generateWithAnthropic({ apiKey: "anthropic-key", model: "claude-fable-4-6", prompt: "dialogue", fetcher })).resolves.toBe("Fable result");
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
    const runner = vi.fn(async (_command: string, args: string[]) => {
      expect(args).toEqual(expect.arrayContaining(["generate", "create", "seedance_2_5", "--prompt", "moon city", "--wait", "--json"]));
      return JSON.stringify([{ outputs: [{ url: "https://cdn.example/video.mp4" }] }]);
    });
    await expect(generateWithHiggsfield({ modelId: "seedance_2_5", prompt: "moon city", args: ["--mode", "t2v"], runner })).resolves.toBe("https://cdn.example/video.mp4");
  });
});

describe("subscription CLI adapters", () => {
  it("accepts Codex login status when the CLI writes it to stderr", () => {
    expect(subscriptionCliIsLoggedIn("codex", "", "Logged in using ChatGPT\n")).toBe(true);
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

  it("runs Claude Code without tools and parses its JSON result", async () => {
    const runner = vi.fn(async (input: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdin: string }) => {
      expect(input.command).toBe("claude-test");
      expect(input.args).toEqual(expect.arrayContaining([
        "--print", "--output-format", "json", "--max-turns", "1", "--no-session-persistence",
        "--safe-mode", "--restricted", "--strict-mcp-config", "--tools", ""
      ]));
      expect(input.args).not.toContain("explain this code");
      expect(input.stdin).toContain("explain this code");
      expect(input.env.WORKER_ACCESS_TOKEN).toBeUndefined();
      expect(input.env.ANTHROPIC_API_KEY).toBeUndefined();
      return JSON.stringify({ type: "result", subtype: "success", result: "Claude subscription result" });
    });
    await expect(generateWithClaudeCodeSubscription({
      command: "claude-test",
      prompt: "explain this code",
      sourceEnv: { PATH: "test-path", HOME: "test-home", WORKER_ACCESS_TOKEN: "secret", ANTHROPIC_API_KEY: "secret" },
      runner
    })).resolves.toBe("Claude subscription result");
  });
});

describe("worker provider registry", () => {
  it("requires explicit capabilities and fails closed when a hosted credential is missing", () => {
    expect(() => buildWorkerExecutor({ WORKER_CAPABILITIES: "text.openai.sol" })).toThrow("OPENAI_API_KEY is required");
    expect(() => buildWorkerExecutor({ WORKER_CAPABILITIES: "text.deepseek.flash" })).toThrow("DEEPSEEK_API_KEY is required");
  });

  it("builds only the explicitly approved worker capabilities", () => {
    const worker = buildWorkerExecutor({
      WORKER_CAPABILITIES: "text.ollama,text.anthropic.fable,text.deepseek.v4-pro",
      ANTHROPIC_API_KEY: "configured",
      DEEPSEEK_API_KEY: "configured"
    });
    expect(worker.capabilities).toEqual(["text.ollama", "text.anthropic.fable", "text.deepseek.v4-pro"]);
  });

  it("requires explicit subscription CLI opt-in and verifies local login before advertising it", () => {
    expect(() => buildWorkerExecutor({ WORKER_CAPABILITIES: "text.openai.codex" })).toThrow("SUBSCRIPTION_CLI_ENABLED=true is required");
    const probe = vi.fn();
    const worker = buildWorkerExecutor({
      WORKER_CAPABILITIES: "text.openai.codex,text.anthropic.claude-code",
      SUBSCRIPTION_CLI_ENABLED: "true",
      CODEX_COMMAND: "codex-test",
      CLAUDE_CODE_COMMAND: "claude-test"
    }, { subscriptionProbe: probe });
    expect(probe).toHaveBeenCalledWith("codex", "codex-test", expect.any(Object));
    expect(probe).toHaveBeenCalledWith("claude-code", "claude-test", expect.any(Object));
    expect(worker.capabilities).toEqual(["text.openai.codex", "text.anthropic.claude-code"]);
  });
});
