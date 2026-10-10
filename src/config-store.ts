import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { detectWorkerCapabilities, type DetectedService } from "./capability-detector.js";
import { validateCoordinatorUrl } from "./coordinator-url.js";

type Env = Record<string, string | undefined>;
type EnrollmentFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type DashboardConfigSummary = {
  coordinatorUrl: string;
  workerName: string;
  workerId: string;
  workerCapabilities: string[];
  acceptPublicRequests: boolean;
  workerAccessTokenSet: boolean;
  subscriptionCliEnabled: boolean;
  codexCommand: string;
  codexModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiApiKeySet: boolean;
  openaiChatgptModel: string;
  openaiSolModel: string;
  openaiImageModel: string;
  anthropicApiKeySet: boolean;
  anthropicFableModel: string;
  deepseekApiKeySet: boolean;
  deepseekBaseUrl: string;
  deepseekFlashModel: string;
  deepseekProModel: string;
  higgsfieldEnabled: boolean;
  higgsfieldCommand: string;
  higgsfieldGenjutsuModelId: string;
  services: DetectedService[];
};

export type DashboardConfigUpdate = Partial<{
  coordinatorUrl: string;
  workerName: string;
  acceptPublicRequests: boolean;
  subscriptionCliEnabled: boolean;
  codexCommand: string;
  codexModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiApiKey: string;
  openaiChatgptModel: string;
  openaiSolModel: string;
  openaiImageModel: string;
  anthropicApiKey: string;
  anthropicFableModel: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekFlashModel: string;
  deepseekProModel: string;
  higgsfieldEnabled: boolean;
  higgsfieldCommand: string;
  higgsfieldGenjutsuModelId: string;
}>;

const KEY_BY_FIELD: Record<keyof DashboardConfigUpdate, string> = {
  coordinatorUrl: "COORDINATOR_URL",
  workerName: "WORKER_NAME",
  acceptPublicRequests: "ACCEPT_PUBLIC_REQUESTS",
  subscriptionCliEnabled: "SUBSCRIPTION_CLI_ENABLED",
  codexCommand: "CODEX_COMMAND",
  codexModel: "CODEX_MODEL",
  ollamaBaseUrl: "OLLAMA_BASE_URL",
  ollamaModel: "OLLAMA_MODEL",
  openaiApiKey: "OPENAI_API_KEY",
  openaiChatgptModel: "OPENAI_CHATGPT_MODEL",
  openaiSolModel: "OPENAI_SOL_MODEL",
  openaiImageModel: "OPENAI_IMAGE_MODEL",
  anthropicApiKey: "ANTHROPIC_API_KEY",
  anthropicFableModel: "ANTHROPIC_FABLE_MODEL",
  deepseekApiKey: "DEEPSEEK_API_KEY",
  deepseekBaseUrl: "DEEPSEEK_BASE_URL",
  deepseekFlashModel: "DEEPSEEK_FLASH_MODEL",
  deepseekProModel: "DEEPSEEK_PRO_MODEL",
  higgsfieldEnabled: "HIGGSFIELD_ENABLED",
  higgsfieldCommand: "HIGGSFIELD_COMMAND",
  higgsfieldGenjutsuModelId: "HIGGSFIELD_GENJUTSU_MODEL_ID"
};

function parseEnv(text: string): Env {
  const env: Env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function csv(value: string | undefined, fallback: string[]): string[] {
  const parsed = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return parsed.length ? [...new Set(parsed)] : fallback;
}

function bool(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.includes(String.fromCharCode(10)) || trimmed.includes(String.fromCharCode(13)) || trimmed.includes(String.fromCharCode(0))) {
    throw new Error(`${field} must be a single-line value`);
  }
  return trimmed;
}

function summarize(env: Env, services: DetectedService[]): DashboardConfigSummary {
  return {
    coordinatorUrl: env.COORDINATOR_URL?.trim() || "https://api-production-cc9f.up.railway.app",
    workerName: env.WORKER_NAME?.trim() || "friend-worker-1",
    workerId: env.WORKER_ID?.trim() || "",
    workerCapabilities: csv(env.WORKER_CAPABILITIES, []),
    acceptPublicRequests: bool(env.ACCEPT_PUBLIC_REQUESTS),
    workerAccessTokenSet: Boolean(env.WORKER_ACCESS_TOKEN?.trim()),
    subscriptionCliEnabled: bool(env.SUBSCRIPTION_CLI_ENABLED),
    codexCommand: env.CODEX_COMMAND?.trim() || "codex",
    codexModel: env.CODEX_MODEL?.trim() || "",
    ollamaBaseUrl: env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    ollamaModel: env.OLLAMA_MODEL?.trim() || "llama3.2",
    openaiApiKeySet: Boolean(env.OPENAI_API_KEY?.trim()),
    openaiChatgptModel: env.OPENAI_CHATGPT_MODEL?.trim() || "gpt-5.4-mini",
    openaiSolModel: env.OPENAI_SOL_MODEL?.trim() || "openai-sol-2026-07-20",
    openaiImageModel: env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2",
    anthropicApiKeySet: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    anthropicFableModel: env.ANTHROPIC_FABLE_MODEL?.trim() || "claude-fable-5",
    deepseekApiKeySet: Boolean(env.DEEPSEEK_API_KEY?.trim()),
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    deepseekFlashModel: env.DEEPSEEK_FLASH_MODEL?.trim() || "deepseek-flash",
    deepseekProModel: env.DEEPSEEK_PRO_MODEL?.trim() || "deepseek-v4-pro",
    higgsfieldEnabled: bool(env.HIGGSFIELD_ENABLED),
    higgsfieldCommand: env.HIGGSFIELD_COMMAND?.trim() || "higgsfield",
    higgsfieldGenjutsuModelId: env.HIGGSFIELD_GENJUTSU_MODEL_ID?.trim() || "",
    services
  };
}

function serializeValue(value: unknown, field: keyof DashboardConfigUpdate): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return stringValue(value, field);
}

function applyUpdatesToText(text: string, updates: DashboardConfigUpdate): { text: string; env: Env } {
  let next = text.endsWith("\n") ? text : `${text}\n`;
  for (const [field, rawValue] of Object.entries(updates) as [keyof DashboardConfigUpdate, unknown][]) {
    if (rawValue === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(KEY_BY_FIELD, field)) throw new Error(`${field}: unsupported configuration field`);
    const key = KEY_BY_FIELD[field];
    const value = serializeValue(rawValue, field);
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, line) : `${next}${line}\n`;
  }
  return { text: next, env: parseEnv(next) };
}

function applyEnvValues(text: string, values: Record<string, string>): string {
  let next = text.endsWith("\n") ? text : `${text}\n`;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, line) : `${next}${line}\n`;
  }
  return next;
}

export function windowsAclIsOwnerOnly(output: string, envPath: string, account: string): boolean {
  const expected = account.trim().toUpperCase();
  if (!expected) return false;
  const pathUpper = envPath.toUpperCase();
  const entries = output.split("\n").flatMap((line) => {
    const marker = line.indexOf(":(");
    if (marker < 0) return [];
    let principal = line.slice(0, marker).trim();
    if (principal.toUpperCase().startsWith(pathUpper)) principal = principal.slice(envPath.length).trim();
    return principal ? [{ principal: principal.toUpperCase(), rights: line.slice(marker) }] : [];
  });
  return entries.length === 1
    && entries[0].principal === expected
    && entries[0].rights.includes("(F)")
    && !entries[0].rights.toUpperCase().includes("DENY");
}

export function createDashboardConfigStore(
  envPath: string,
  baseEnv: Env = process.env,
  options: { detector?: typeof detectWorkerCapabilities; fetcher?: EnrollmentFetcher } = {}
) {
  const detector = options.detector ?? detectWorkerCapabilities;
  const fetcher = options.fetcher ?? fetch;
  async function securePath(path: string): Promise<void> {
    if (process.platform === "win32") {
      const username = process.env.USERNAME?.trim();
      const domain = process.env.USERDOMAIN?.trim();
      if (!username || !domain) throw new Error("Cannot secure .env without the current Windows account");
      const account = `${domain}\\${username}`;
      const result = spawnSync("icacls", [path, "/inheritance:r", "/grant:r", `${account}:(F)`], { windowsHide: true, encoding: "utf8" });
      if (result.status !== 0) throw new Error("Failed to restrict .env permissions to the current Windows user");
      const verified = spawnSync("icacls", [path], { windowsHide: true, encoding: "utf8" });
      if (verified.status !== 0 || !windowsAclIsOwnerOnly(verified.stdout, path, account)) {
        throw new Error("Failed to verify owner-only .env permissions");
      }
    } else {
      await chmod(path, 0o600);
    }
  }
  async function writeEnvFile(content: string): Promise<void> {
    const tempPath = `${envPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tempPath, "", { flag: "wx", mode: 0o600 });
      await securePath(tempPath);
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, envPath);
      await securePath(envPath);
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }
  async function readMergedEnv(): Promise<Env> {
    let fileEnv: Env = {};
    try { fileEnv = parseEnv(await readFile(envPath, "utf8")); } catch {}
    return { ...baseEnv, ...fileEnv };
  }
  return {
    async ensureWorkerIdentity(): Promise<{ workerId: string; workerTokenSet: boolean }> {
      let current = "";
      try { current = await readFile(envPath, "utf8"); } catch {}
      const merged = await readMergedEnv();
      const fileEnv = parseEnv(current);
      const fileId = fileEnv.WORKER_ID?.trim() || "";
      const fileToken = fileEnv.WORKER_ACCESS_TOKEN?.trim() || "";
      const fileHasIdentityFields = Object.prototype.hasOwnProperty.call(fileEnv, "WORKER_ID")
        || Object.prototype.hasOwnProperty.call(fileEnv, "WORKER_ACCESS_TOKEN");
      const existingId = fileId && fileToken ? fileId : fileHasIdentityFields ? "" : baseEnv.WORKER_ID?.trim() || "";
      const existingToken = fileId && fileToken ? fileToken : fileHasIdentityFields ? "" : baseEnv.WORKER_ACCESS_TOKEN?.trim() || "";
      const coordinator = validateCoordinatorUrl(merged.COORDINATOR_URL?.trim() || "https://api-production-cc9f.up.railway.app");
      if (/^[a-zA-Z0-9_-]{3,64}$/.test(existingId) && existingToken) {
        const verified = await fetcher(`${coordinator}/api/workers/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${existingToken}`, "x-worker-id": existingId }
        });
        if (verified.status === 204) return { workerId: existingId, workerTokenSet: true };
        if (verified.status !== 401 && verified.status !== 403) throw new Error(`worker identity verification failed (${verified.status})`);
      }
      const name = merged.WORKER_NAME?.trim() || "Worker";
      const response = await fetcher(`${coordinator}/api/workers/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!response.ok) throw new Error(`worker enrollment failed (${response.status})`);
      const enrolled = await response.json() as { workerId?: unknown; workerToken?: unknown };
      if (typeof enrolled.workerId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(enrolled.workerId)
        || typeof enrolled.workerToken !== "string" || !/^bncw_[A-Za-z0-9_-]{43}$/.test(enrolled.workerToken)) {
        throw new Error("coordinator returned an invalid worker identity");
      }
      const next = applyEnvValues(current, { WORKER_ID: enrolled.workerId, WORKER_ACCESS_TOKEN: enrolled.workerToken });
      await writeEnvFile(next);
      process.env.WORKER_ID = enrolled.workerId;
      process.env.WORKER_ACCESS_TOKEN = enrolled.workerToken;
      return { workerId: enrolled.workerId, workerTokenSet: true };
    },
    async summary(options: { persistDetection?: boolean } = {}): Promise<DashboardConfigSummary> {
      let current = "";
      try { current = await readFile(envPath, "utf8"); } catch {}
      const merged = await readMergedEnv();
      const detection = await detector(merged);
      if (options.persistDetection === false) {
        return summarize({ ...merged, ...detection.envUpdates }, detection.services);
      }
      const detectedText = applyEnvValues(current, detection.envUpdates);
      await writeEnvFile(detectedText);
      for (const [key, value] of Object.entries(detection.envUpdates)) process.env[key] = value;
      return summarize({ ...merged, ...detection.envUpdates }, detection.services);
    },
    async save(update: DashboardConfigUpdate): Promise<DashboardConfigSummary> {
      let current = "";
      try { current = await readFile(envPath, "utf8"); } catch {}
      const { text, env } = applyUpdatesToText(current, update);
      const detection = await detector({ ...baseEnv, ...env });
      const detectedText = applyEnvValues(text, detection.envUpdates);
      const detectedEnv = { ...env, ...detection.envUpdates };
      await writeEnvFile(detectedText);
      for (const [key, value] of Object.entries(detectedEnv)) {
        if (value !== undefined) process.env[key] = value;
      }
      return summarize({ ...baseEnv, ...detectedEnv }, detection.services);
    }
  };
}
