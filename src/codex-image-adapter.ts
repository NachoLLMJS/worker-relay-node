import { createHash, randomUUID } from "node:crypto";
import { stat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

type Env = Record<string, string | undefined>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const CODEX_IMAGE_URL = "https://chatgpt.com/backend-api/codex/images/generations";
const MAX_AUTH_FILE_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_RESPONSE_BYTES = MAX_BASE64_CHARS + 1_000_000;
const MAX_TIMEOUT_MS = 300_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const authSchema = z.object({
  auth_mode: z.string(),
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().min(1).optional()
  })
});

const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1)
});
const readinessSchema = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive() });

export type CodexSubscriptionCredential = {
  accessToken: string;
  accountId?: string;
  residency?: string;
};

function authPath(sourceEnv: Env): string {
  const configuredHome = sourceEnv.CODEX_HOME?.trim();
  if (configuredHome) return join(configuredHome, "auth.json");
  const home = sourceEnv.HOME?.trim() || sourceEnv.USERPROFILE?.trim() || homedir();
  if (!home) throw new Error("Codex ChatGPT OAuth credentials are unavailable");
  return join(home, ".codex", "auth.json");
}

function jwtClaims(accessToken: string): { accountId?: string; residency?: string } {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2 || !parts[1]) return {};
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"];
    if (!auth || typeof auth !== "object") return {};
    const record = auth as Record<string, unknown>;
    const accountId = typeof record.chatgpt_account_id === "string" && record.chatgpt_account_id.trim()
      ? record.chatgpt_account_id.trim()
      : undefined;
    const residencyValue = record.chatgpt_data_residency || record.chatgpt_compute_residency;
    const residency = typeof residencyValue === "string" && residencyValue.trim() ? residencyValue.trim() : undefined;
    return { accountId, residency };
  } catch {
    return {};
  }
}

export async function readCodexSubscriptionCredential(sourceEnv: Env = process.env): Promise<CodexSubscriptionCredential> {
  const path = authPath(sourceEnv);
  let fileInfo;
  try {
    fileInfo = await stat(path);
  } catch {
    throw new Error("Codex ChatGPT OAuth credentials are unavailable");
  }
  if (!fileInfo.isFile() || fileInfo.size <= 0 || fileInfo.size > MAX_AUTH_FILE_BYTES) {
    throw new Error("Codex ChatGPT OAuth credential store is invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Codex ChatGPT OAuth credential store is invalid");
  }
  const auth = authSchema.safeParse(parsed);
  if (!auth.success || auth.data.auth_mode.toLowerCase() !== "chatgpt") {
    throw new Error("Codex must use ChatGPT OAuth authentication for subscription images");
  }
  const claims = jwtClaims(auth.data.tokens.access_token);
  return {
    accessToken: auth.data.tokens.access_token,
    accountId: auth.data.tokens.account_id || claims.accountId,
    residency: claims.residency
  };
}

function fixedFailure(status: number): Error {
  const kind = status === 401 || status === 403 ? "authentication_failed"
    : status === 429 ? "rate_limited"
    : status >= 500 ? "service_error"
    : status === 400 || status === 404 || status === 422 ? "invalid_request"
    : "unknown_error";
  return new Error(`Codex image request failed: status=${status} | kind=${kind}`);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new Error("Codex image response exceeded the size limit");
  }
  if (!response.body) throw new Error("Codex image response was invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Codex image response exceeded the size limit");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"));
  } catch (error) {
    if (error instanceof Error && error.message === "Codex image response exceeded the size limit") throw error;
    throw new Error("Codex image response was invalid");
  }
}

function validPngStructure(bytes: Buffer): boolean {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
  let offset = PNG_SIGNATURE.length;
  let chunks = 0;
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > bytes.length) return false;
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index += 1) {
      crc = CRC32_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) return false;
    if (chunks === 0) {
      if (type !== "IHDR" || length !== 13) return false;
      if (bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) return false;
      const bitDepth = bytes[offset + 16]!;
      const colorType = bytes[offset + 17]!;
      const allowedDepths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      };
      if (!allowedDepths[colorType]?.includes(bitDepth)
        || bytes[offset + 18] !== 0
        || bytes[offset + 19] !== 0
        || (bytes[offset + 20] !== 0 && bytes[offset + 20] !== 1)) return false;
    }
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") return length === 0 && sawIdat && end === bytes.length;
    offset = end;
    chunks += 1;
  }
  return false;
}

function validatedPngBase64(value: string): string {
  if (value.length > MAX_BASE64_CHARS) throw new Error("Codex image output exceeded the size limit");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Codex image output was not valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Codex image output exceeded the size limit");
  if (!validPngStructure(bytes)) {
    throw new Error("Codex image output was not a valid PNG");
  }
  return value;
}

export async function generateWithCodexImageSubscription(input: {
  prompt: string;
  sourceEnv?: Env;
  fetcher?: Fetcher;
  timeoutMs?: number;
  quality?: "low" | "medium" | "high";
  size?: "1024x1024" | "1536x1024" | "1024x1536";
}): Promise<string> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Codex image prompt is required");
  if (prompt.length > 8_000) throw new Error("Codex image prompt exceeds the limit");

  const credential = await readCodexSubscriptionCredential(input.sourceEnv);
  const headers: Record<string, string> = {
    authorization: `Bearer ${credential.accessToken}`,
    "content-type": "application/json",
    "user-agent": "WorkerRelayNode/0.2.0",
    originator: "worker-relay-node",
    "x-codex-image-turn-id": randomUUID()
  };
  if (credential.accountId) headers["ChatGPT-Account-ID"] = credential.accountId;
  if (credential.residency) headers["x-openai-internal-codex-residency"] = credential.residency;

  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(CODEX_IMAGE_URL, {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify({
        prompt,
        model: "gpt-image-2",
        n: 1,
        quality: input.quality ?? "medium",
        size: input.size ?? "1536x1024",
        background: "opaque"
      }),
      signal: AbortSignal.timeout(Number.isFinite(input.timeoutMs)
        ? Math.min(MAX_TIMEOUT_MS, Math.max(1_000, input.timeoutMs!))
        : MAX_TIMEOUT_MS)
    });
  } catch {
    throw new Error("Codex image request failed: kind=network_error");
  }
  if (!response.ok) throw fixedFailure(response.status);

  const payload = await readBoundedJson(response);
  const parsed = imageResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Codex image response contained no image data");
  if (parsed.data.data.length !== 1) throw new Error("Codex image response must contain exactly one image");
  const b64 = validatedPngBase64(parsed.data.data[0]!.b64_json);
  return `data:image/png;base64,${b64}`;
}

const readiness = new Map<string, { expiresAt: number; promise: Promise<void> }>();

function readinessPath(sourceEnv: Env): string {
  return join(dirname(authPath(sourceEnv)), ".worker-relay-image-readiness.json");
}

async function readPersistedReadiness(sourceEnv: Env): Promise<{ key: string; expiresAt: number } | null> {
  const path = readinessPath(sourceEnv);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0 || info.size > 1_024) return null;
    const parsed = readinessSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writePersistedReadiness(sourceEnv: Env, value: { key: string; expiresAt: number }): Promise<void> {
  const path = readinessPath(sourceEnv);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export async function probeCodexImageSubscription(input: {
  sourceEnv?: Env;
  fetcher?: Fetcher;
  now?: () => number;
} = {}): Promise<void> {
  const credential = await readCodexSubscriptionCredential(input.sourceEnv);
  const sourceEnv = input.sourceEnv ?? process.env;
  const fingerprint = createHash("sha256")
    .update(credential.accountId ? `account:${credential.accountId}` : `token:${credential.accessToken}`)
    .digest("hex");
  const now = input.now ?? Date.now;
  const cached = readiness.get(fingerprint);
  if (cached && cached.expiresAt > now()) return cached.promise;
  const persisted = await readPersistedReadiness(sourceEnv);
  if (persisted?.key === fingerprint && persisted.expiresAt > now()) {
    const promise = Promise.resolve();
    readiness.set(fingerprint, { expiresAt: persisted.expiresAt, promise });
    return promise;
  }

  const expiresAt = now() + 6 * 60 * 60_000;
  const promise = generateWithCodexImageSubscription({
    prompt: "A plain solid black square with no text.",
    sourceEnv: input.sourceEnv,
    fetcher: input.fetcher,
    quality: "low",
    size: "1024x1024"
  }).then(() => undefined);
  readiness.set(fingerprint, { expiresAt, promise });
  try {
    await promise;
    await writePersistedReadiness(sourceEnv, { key: fingerprint, expiresAt }).catch(() => {});
  } catch (error) {
    readiness.delete(fingerprint);
    throw error;
  }
}
