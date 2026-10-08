import { describe, expect, it, vi } from "vitest";
import { generateWithAnthropic } from "../src/anthropic-adapter.js";
import { generateWithHiggsfield } from "../src/higgsfield-adapter.js";
import { generateWithOpenAI } from "../src/openai-adapter.js";
import { buildWorkerExecutor } from "../src/provider-registry.js";

describe("hosted text adapters", () => {
  it("calls the OpenAI Responses API and returns output text", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer openai-key" });
      expect(JSON.parse(String(init?.body))).toEqual({ model: "openai-sol-2026-07-20", input: "hello" });
      return new Response(JSON.stringify({ output_text: "Hello from Sol" }), { status: 200 });
    });
    await expect(generateWithOpenAI({ apiKey: "openai-key", model: "openai-sol-2026-07-20", prompt: "hello", fetcher })).resolves.toBe("Hello from Sol");
  });

  it("calls Anthropic Messages and returns Fable text", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "claude-fable-4-6", messages: [{ role: "user", content: "dialogue" }] });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Fable result" }] }), { status: 200 });
    });
    await expect(generateWithAnthropic({ apiKey: "anthropic-key", model: "claude-fable-4-6", prompt: "dialogue", fetcher })).resolves.toBe("Fable result");
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

describe("worker provider registry", () => {
  it("requires explicit capabilities and fails closed when a hosted credential is missing", () => {
    expect(() => buildWorkerExecutor({ WORKER_CAPABILITIES: "text.openai.sol" })).toThrow("OPENAI_API_KEY is required");
  });

  it("builds only the explicitly approved worker capabilities", () => {
    const worker = buildWorkerExecutor({
      WORKER_CAPABILITIES: "text.ollama,text.anthropic.fable",
      ANTHROPIC_API_KEY: "configured"
    });
    expect(worker.capabilities).toEqual(["text.ollama", "text.anthropic.fable"]);
  });
});
