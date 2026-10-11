import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWithCodexImageSubscription, probeCodexImageSubscription, readCodexSubscriptionCredential } from "../src/codex-image-adapter.js";

const directories: string[] = [];

function jwt(payload: object): string {
  return ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}

async function authHome(auth: object): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "worker-codex-image-test-"));
  directories.push(directory);
  await writeFile(join(directory, "auth.json"), JSON.stringify(auth), { encoding: "utf8", mode: 0o600 });
  return directory;
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Codex subscription image adapter", () => {
  it("reads only ChatGPT OAuth credentials from the official Codex store", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123", chatgpt_data_residency: "us" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken, account_id: "acct-123" } });

    await expect(readCodexSubscriptionCredential({ CODEX_HOME: codexHome })).resolves.toMatchObject({
      accessToken,
      accountId: "acct-123",
      residency: "us"
    });
  });

  it("uses the standard .codex/auth.json location when CODEX_HOME is unset", async () => {
    const home = await mkdtemp(join(tmpdir(), "worker-codex-home-test-"));
    directories.push(home);
    const directory = join(home, ".codex");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(directory));
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-standard" } });
    await writeFile(join(directory, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: accessToken } }));

    await expect(readCodexSubscriptionCredential({ HOME: home })).resolves.toMatchObject({ accountId: "acct-standard" });
  });

  it("rejects API-key mode and malformed Codex auth without exposing credential values", async () => {
    const codexHome = await authHome({ auth_mode: "apikey", OPENAI_API_KEY: "must-not-appear" });
    await expect(readCodexSubscriptionCredential({ CODEX_HOME: codexHome })).rejects.toThrow("ChatGPT OAuth");
    try {
      await readCodexSubscriptionCredential({ CODEX_HOME: codexHome });
    } catch (error) {
      expect(String(error)).not.toContain("must-not-appear");
    }
  });

  it("posts to the native Codex image endpoint and returns a validated PNG data URL", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123", chatgpt_compute_residency: "eu" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken } });
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://chatgpt.com/backend-api/codex/images/generations");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`);
      expect(headers.get("chatgpt-account-id")).toBe("acct-123");
      expect(headers.get("x-openai-internal-codex-residency")).toBe("eu");
      expect(headers.get("originator")).toBe("worker-relay-node");
      expect(headers.get("x-codex-image-turn-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(String(init?.body))).toEqual({
        prompt: "a yellow circle on navy",
        model: "gpt-image-2",
        n: 1,
        quality: "medium",
        size: "1536x1024",
        background: "opaque"
      });
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 });
    });

    await expect(generateWithCodexImageSubscription({
      prompt: "a yellow circle on navy",
      sourceEnv: { CODEX_HOME: codexHome, WORKER_ACCESS_TOKEN: "worker-secret" },
      fetcher
    })).resolves.toBe(`data:image/png;base64,${png.toString("base64")}`);
  });

  it("rejects responses containing more than one image", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: png.toString("base64") }, { b64_json: png.toString("base64") }]
    }), { status: 200 }));

    await expect(generateWithCodexImageSubscription({
      prompt: "one image",
      sourceEnv: { CODEX_HOME: codexHome },
      fetcher
    })).rejects.toThrow("exactly one image");
  });

  it("reuses a successful readiness probe across token rotation and process restart for the same account", async () => {
    const accountClaim = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-stable" } };
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: jwt(accountClaim) } });
    const firstFetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }));
    await probeCodexImageSubscription({ sourceEnv: { CODEX_HOME: codexHome }, fetcher: firstFetch });
    expect(firstFetch).toHaveBeenCalledOnce();

    await writeFile(join(codexHome, "auth.json"), JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: `${jwt(accountClaim)}-rotated` }
    }));
    vi.resetModules();
    const fresh = await import("../src/codex-image-adapter.js");
    const secondFetch = vi.fn(async () => new Response("should not run", { status: 500 }));
    await fresh.probeCodexImageSubscription({ sourceEnv: { CODEX_HOME: codexHome }, fetcher: secondFetch });
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it("returns fixed error categories without response bodies, prompts, or OAuth tokens", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken } });
    const privatePrompt = "private image request";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: `${privatePrompt} ${accessToken}` } }), { status: 429 }));

    try {
      await generateWithCodexImageSubscription({ prompt: privatePrompt, sourceEnv: { CODEX_HOME: codexHome }, fetcher });
      throw new Error("expected request failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("kind=rate_limited");
      expect(message).not.toContain(privatePrompt);
      expect(message).not.toContain(accessToken);
    }
  });

  it("rejects oversized response bodies before buffering their JSON", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken } });
    const fetcher = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "50000000" }
    }));

    await expect(generateWithCodexImageSubscription({
      prompt: "safe",
      sourceEnv: { CODEX_HOME: codexHome },
      fetcher
    })).rejects.toThrow("response exceeded the size limit");
  });

  it("caps custom request timeouts at the production maximum", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken } });
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }));

    await generateWithCodexImageSubscription({
      prompt: "safe",
      sourceEnv: { CODEX_HOME: codexHome },
      fetcher,
      timeoutMs: 999_999_999
    });
    expect(timeout).toHaveBeenCalledWith(300_000);
    timeout.mockRestore();
  });

  it("rejects non-PNG and oversized image payloads", async () => {
    const accessToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });
    const codexHome = await authHome({ auth_mode: "chatgpt", tokens: { access_token: accessToken } });
    const nonPng = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }), { status: 200 }));
    await expect(generateWithCodexImageSubscription({ prompt: "safe", sourceEnv: { CODEX_HOME: codexHome }, fetcher: nonPng })).rejects.toThrow("valid PNG");

    const truncatedPng = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.subarray(0, png.length - 8).toString("base64") }] }), { status: 200 }));
    await expect(generateWithCodexImageSubscription({ prompt: "safe", sourceEnv: { CODEX_HOME: codexHome }, fetcher: truncatedPng })).rejects.toThrow("valid PNG");

    const trailingPng = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.concat([png, Buffer.from("trailing")]).toString("base64") }] }), { status: 200 }));
    await expect(generateWithCodexImageSubscription({ prompt: "safe", sourceEnv: { CODEX_HOME: codexHome }, fetcher: trailingPng })).rejects.toThrow("valid PNG");

    const corrupted = Buffer.from(png);
    const idat = corrupted.indexOf(Buffer.from("IDAT"));
    corrupted[idat + 4] = corrupted[idat + 4]! ^ 1;
    const badCrc = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: corrupted.toString("base64") }] }), { status: 200 }));
    await expect(generateWithCodexImageSubscription({ prompt: "safe", sourceEnv: { CODEX_HOME: codexHome }, fetcher: badCrc })).rejects.toThrow("valid PNG");

    const invalidIhdr = Buffer.from(png);
    invalidIhdr[24] = 3;
    invalidIhdr.writeUInt32BE(crc32(invalidIhdr.subarray(12, 29)), 29);
    const badIhdr = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: invalidIhdr.toString("base64") }] }), { status: 200 }));
    await expect(generateWithCodexImageSubscription({ prompt: "safe", sourceEnv: { CODEX_HOME: codexHome }, fetcher: badIhdr })).rejects.toThrow("valid PNG");

    const oversized = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: `iVBORw0KGgo${"A".repeat(45_000_000)}` }] }), { status: 200 }));
    await expect(generateWithCodexImageSubscription({ prompt: "safe", sourceEnv: { CODEX_HOME: codexHome }, fetcher: oversized })).rejects.toThrow("size limit");
  });
});
