import { describe, expect, it, vi } from "vitest";
import { detectWorkerCapabilities } from "../src/capability-detector.js";

const serviceState = (result: Awaited<ReturnType<typeof detectWorkerCapabilities>>, id: string) =>
  result.services.find((service) => service.id === id)?.state;

describe("automatic worker capability detection", () => {
  it("advertises hosted services only when their local API credentials authenticate", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://127.0.0.1:11434/api/tags") return new Response("unavailable", { status: 503 });
      if (url === "https://api.openai.com/v1/models") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer openai-local");
        return new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), { status: 200 });
      }
      if (url === "https://api.anthropic.com/v1/models") {
        expect(new Headers(init?.headers).get("x-api-key")).toBe("anthropic-local");
        return new Response(JSON.stringify({ data: [{ id: "claude" }] }), { status: 200 });
      }
      if (url === "https://api.deepseek.com/v1/models") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer deepseek-local");
        return new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await detectWorkerCapabilities({
      OPENAI_API_KEY: "openai-local",
      ANTHROPIC_API_KEY: "anthropic-local",
      DEEPSEEK_API_KEY: "deepseek-local"
    }, { fetcher });

    expect(result.capabilities).toEqual(expect.arrayContaining([
      "text.openai.chatgpt", "text.openai.sol", "image.openai.gpt-image-2",
      "text.anthropic.fable", "text.deepseek.flash", "text.deepseek.v4-pro"
    ]));
    expect(serviceState(result, "text.ollama")).toBe("unavailable");
  });

  it("does not advertise a hosted provider when its configured key fails authentication", async () => {
    const result = await detectWorkerCapabilities({ OPENAI_API_KEY: "invalid-local" }, {
      fetcher: vi.fn(async (url: string) => url.includes("api.openai.com")
        ? new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })
        : new Response("unavailable", { status: 503 }))
    });
    expect(result.capabilities).not.toContain("text.openai.chatgpt");
    expect(result.capabilities).not.toContain("image.openai.gpt-image-2");
  });

  it("advertises Ollama only when tags responds with a usable model and selects the first installed model", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:11434/api/tags");
      return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3.2:latest" }] }), { status: 200 });
    });
    const result = await detectWorkerCapabilities({ OLLAMA_MODEL: "missing" }, { fetcher });

    expect(result.capabilities).toEqual(["text.ollama"]);
    expect(result.envUpdates).toMatchObject({ OLLAMA_MODEL: "qwen3:8b", WORKER_CAPABILITIES: "text.ollama" });
  });

  it("keeps an untagged configured Ollama model when the installed latest tag matches", async () => {
    const result = await detectWorkerCapabilities({ OLLAMA_MODEL: "llama3.2" }, {
      fetcher: vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }), { status: 200 }))
    });
    expect(result.envUpdates.OLLAMA_MODEL).toBe("llama3.2");
  });

  it("keeps the configured Ollama model when it is installed", async () => {
    const result = await detectWorkerCapabilities({ OLLAMA_MODEL: "llama3.2:latest" }, {
      fetcher: vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3.2:latest" }] }), { status: 200 }))
    });
    expect(result.envUpdates.OLLAMA_MODEL).toBe("llama3.2:latest");
  });

  it("advertises Codex only when enabled and the portable login probe passes", async () => {
    const probe = vi.fn();
    const ready = await detectWorkerCapabilities({ SUBSCRIPTION_CLI_ENABLED: "true", CODEX_COMMAND: "codex" }, {
      fetcher: vi.fn(async () => new Response("unavailable", { status: 503 })),
      subscriptionProbe: probe
    });
    expect(probe).toHaveBeenCalledWith("codex", "codex", expect.any(Object));
    expect(ready.capabilities).toContain("text.openai.codex");

    const disabledProbe = vi.fn();
    const disabled = await detectWorkerCapabilities({}, {
      fetcher: vi.fn(async () => new Response("unavailable", { status: 503 })),
      subscriptionProbe: disabledProbe
    });
    expect(disabledProbe).not.toHaveBeenCalled();
    expect(disabled.capabilities).not.toContain("text.openai.codex");
  });

  it("advertises Higgsfield only after account status succeeds and includes Genjutsu only when its model ID exists", async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("account")) return JSON.stringify({ plan: "creator" });
      return JSON.stringify([{ id: "nano_banana_flash" }, { id: "custom_genjutsu_v2" }]);
    });
    const result = await detectWorkerCapabilities({
      HIGGSFIELD_ENABLED: "true",
      HIGGSFIELD_COMMAND: "higgsfield-test",
      HIGGSFIELD_GENJUTSU_MODEL_ID: "custom_genjutsu_v2"
    }, {
      fetcher: vi.fn(async () => new Response("unavailable", { status: 503 })),
      higgsfieldRunner: runner
    });

    expect(runner).toHaveBeenCalledWith("higgsfield-test", ["account", "status", "--json"], expect.any(Object));
    expect(result.capabilities).toEqual(expect.arrayContaining([
      "image.higgsfield.nano-banana-2", "video.higgsfield.genjutsu"
    ]));
  });

  it("does not advertise Higgsfield services when the authenticated model catalog cannot be read", async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("account")) return JSON.stringify({ plan: "creator" });
      throw new Error("catalog unavailable");
    });
    const result = await detectWorkerCapabilities({ HIGGSFIELD_ENABLED: "true" }, {
      fetcher: vi.fn(async () => new Response("unavailable", { status: 503 })),
      higgsfieldRunner: runner
    });
    expect(result.capabilities.filter((id) => id.includes("higgsfield"))).toEqual([]);
  });
});
