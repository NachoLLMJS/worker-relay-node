import { readFile, writeFile } from "node:fs/promises";
import { listServices } from "./service-catalog.js";

type Env = Record<string, string | undefined>;

export type DashboardConfigSummary = {
  coordinatorUrl: string;
  workerName: string;
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
  services: ReturnType<typeof listServices>;
};

export type DashboardConfigUpdate = Partial<{
  coordinatorUrl: string;
  workerAccessToken: string;
  workerName: string;
  workerCapabilities: string[];
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
  workerAccessToken: "WORKER_ACCESS_TOKEN",
  workerName: "WORKER_NAME",
  workerCapabilities: "WORKER_CAPABILITIES",
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

function validateCapabilities(values: unknown): string[] {
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) throw new Error("workerCapabilities must be a string array");
  const allowed = new Set(listServices().map((service) => service.id));
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!unique.length) throw new Error("at least one capability is required");
  for (const capability of unique) if (!allowed.has(capability)) throw new Error(`${capability}: unsupported capability`);
  return unique;
}

function summarize(env: Env): DashboardConfigSummary {
  return {
    coordinatorUrl: env.COORDINATOR_URL?.trim() || "https://api-production-cc9f.up.railway.app",
    workerName: env.WORKER_NAME?.trim() || "friend-worker-1",
    workerCapabilities: csv(env.WORKER_CAPABILITIES, ["text.ollama"]),
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
    services: listServices()
  };
}

function serializeValue(value: unknown, field: keyof DashboardConfigUpdate): string {
  if (field === "workerCapabilities") return validateCapabilities(value).join(",");
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

export function createDashboardConfigStore(envPath: string, baseEnv: Env = process.env) {
  async function readMergedEnv(): Promise<Env> {
    let fileEnv: Env = {};
    try { fileEnv = parseEnv(await readFile(envPath, "utf8")); } catch {}
    return { ...baseEnv, ...fileEnv };
  }

  return {
    async summary(): Promise<DashboardConfigSummary> {
      return summarize(await readMergedEnv());
    },
    async save(update: DashboardConfigUpdate): Promise<DashboardConfigSummary> {
      let current = "";
      try { current = await readFile(envPath, "utf8"); } catch {}
      const { text, env } = applyUpdatesToText(current, update);
      await writeFile(envPath, text, "utf8");
      for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) process.env[key] = value;
      }
      return summarize({ ...baseEnv, ...env });
    }
  };
}
