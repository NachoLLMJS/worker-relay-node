import { spawn } from "node:child_process";
import { listServices, type ServiceDefinition } from "./service-catalog.js";
import { assertSubscriptionCliReady, subscriptionCliEnvironment, type SubscriptionProbe } from "./subscription-cli-adapter.js";

type Env = Record<string, string | undefined>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type CapabilityState = "available" | "unavailable";
export type DetectedService = ServiceDefinition & { state: CapabilityState; reason: string };
export type HiggsfieldProbeRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

export type DetectionDependencies = {
  fetcher?: Fetcher;
  subscriptionProbe?: SubscriptionProbe;
  higgsfieldRunner?: HiggsfieldProbeRunner;
};

const SAFE_PROCESS_ENV = [
  "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SYSTEMROOT", "SystemRoot",
  "COMSPEC", "ComSpec", "PATHEXT", "TEMP", "TMP", "TERM", "LANG", "LC_ALL", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"
] as const;

function safeProcessEnvironment(source: Env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const name of SAFE_PROCESS_ENV) if (source[name]) safe[name] = source[name];
  return safe;
}

const defaultHiggsfieldRunner: HiggsfieldProbeRunner = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    error ? reject(error) : resolve(stdout);
  };
  const timer = setTimeout(() => {
    child.kill();
    finish(new Error("Higgsfield probe timed out"));
  }, 30_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.length > 1_000_000) {
      child.kill();
      finish(new Error("Higgsfield probe output exceeded the limit"));
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 100_000) {
      child.kill();
      finish(new Error("Higgsfield probe error output exceeded the limit"));
    }
  });
  child.on("error", (error) => finish(error));
  child.on("close", (code) => finish(code === 0 ? undefined : new Error(`Higgsfield probe failed (${code}): ${stderr.trim().slice(0, 300)}`)));
});

function modelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((model) => {
    if (!model || typeof model !== "object") return [];
    const record = model as { name?: unknown; model?: unknown };
    const value = typeof record.name === "string" ? record.name : typeof record.model === "string" ? record.model : "";
    return value.trim() ? [value.trim()] : [];
  });
}

function collectIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^[a-z0-9][a-z0-9._-]+$/i.test(value)) ids.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["id", "model", "model_id", "modelId", "slug"].includes(key) && typeof item === "string") ids.add(item);
      else collectIds(item, ids);
    }
  }
  return ids;
}

function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

async function providerCredentialWorks(fetcher: Fetcher, input: { url: string; headers: HeadersInit }): Promise<boolean> {
  try {
    const response = await fetcher(input.url, { method: "GET", headers: input.headers, signal: AbortSignal.timeout(8_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function detectWorkerCapabilities(env: Env = process.env, dependencies: DetectionDependencies = {}) {
  const available = new Set<string>();
  const reasons = new Map<string, string>();
  const envUpdates: Record<string, string> = {};
  const fetcher = dependencies.fetcher ?? fetch;

  const ollamaBaseUrl = env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  try {
    const response = await fetcher(`${ollamaBaseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const installed = modelNames(await response.json());
    if (!installed.length) throw new Error("no installed models");
    const configured = env.OLLAMA_MODEL?.trim();
    const configuredInstalled = configured && installed.some((model) => model === configured || model === `${configured}:latest`);
    const selected = configuredInstalled ? configured : installed[0]!;
    available.add("text.ollama");
    envUpdates.OLLAMA_MODEL = selected;
    reasons.set("text.ollama", `Installed model detected: ${selected}`);
  } catch {
    reasons.set("text.ollama", "Ollama is not responding with an installed model.");
  }

  const keyProviders = [
    {
      key: "OPENAI_API_KEY",
      executor: "openai",
      url: modelsEndpoint(env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"),
      headers: (key: string) => ({ authorization: `Bearer ${key}` })
    },
    {
      key: "ANTHROPIC_API_KEY",
      executor: "anthropic",
      url: modelsEndpoint(env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com/v1"),
      headers: (key: string) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" })
    },
    {
      key: "DEEPSEEK_API_KEY",
      executor: "deepseek",
      url: modelsEndpoint(env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1"),
      headers: (key: string) => ({ authorization: `Bearer ${key}` })
    }
  ] as const;
  for (const provider of keyProviders) {
    const key = env[provider.key]?.trim();
    const authenticated = Boolean(key) && await providerCredentialWorks(fetcher, { url: provider.url, headers: provider.headers(key!) });
    for (const service of listServices().filter((item) => item.executor === provider.executor)) {
      if (authenticated) available.add(service.id);
      reasons.set(service.id, authenticated ? `${provider.key} authenticated successfully.` : key ? `${provider.key} could not authenticate.` : `${provider.key} is not configured.`);
    }
  }

  if (env.SUBSCRIPTION_CLI_ENABLED?.trim().toLowerCase() === "true") {
    try {
      const command = env.CODEX_COMMAND?.trim() || "codex";
      (dependencies.subscriptionProbe ?? assertSubscriptionCliReady)("codex", command, subscriptionCliEnvironment(env));
      available.add("text.openai.codex");
      reasons.set("text.openai.codex", "Codex CLI and ChatGPT login detected.");
    } catch {
      reasons.set("text.openai.codex", "Codex CLI is unavailable or not logged in with ChatGPT.");
    }
  } else {
    reasons.set("text.openai.codex", "Codex subscription support is disabled.");
  }

  const higgsfieldServices = listServices().filter((service) => service.executor === "higgsfield");
  if (env.HIGGSFIELD_ENABLED?.trim().toLowerCase() === "true") {
    try {
      const command = env.HIGGSFIELD_COMMAND?.trim() || "higgsfield";
      const runner = dependencies.higgsfieldRunner ?? defaultHiggsfieldRunner;
      const safeEnv = safeProcessEnvironment(env);
      await runner(command, ["account", "status", "--json"], safeEnv);
      const catalogIds = collectIds(JSON.parse(await runner(command, ["model", "list", "--json"], safeEnv)));
      if (!catalogIds.size) throw new Error("Higgsfield model catalog is empty");
      for (const service of higgsfieldServices) {
        const modelId = service.id === "video.higgsfield.genjutsu"
          ? env.HIGGSFIELD_GENJUTSU_MODEL_ID?.trim()
          : service.modelId;
        if (modelId && catalogIds.has(modelId)) {
          available.add(service.id);
          reasons.set(service.id, `Higgsfield model detected: ${modelId}`);
        } else {
          reasons.set(service.id, service.id === "video.higgsfield.genjutsu"
            ? "The configured Genjutsu model ID was not found in the Higgsfield catalog."
            : `Higgsfield model is unavailable: ${modelId ?? service.id}`);
        }
      }
    } catch {
      for (const service of higgsfieldServices) reasons.set(service.id, "Higgsfield CLI account status is unavailable.");
    }
  } else {
    for (const service of higgsfieldServices) reasons.set(service.id, "Higgsfield support is disabled.");
  }

  const capabilities = listServices().map((service) => service.id).filter((id) => available.has(id));
  envUpdates.WORKER_CAPABILITIES = capabilities.join(",");
  const services: DetectedService[] = listServices().map((service) => ({
    ...service,
    state: available.has(service.id) ? "available" : "unavailable",
    reason: reasons.get(service.id) || "Provider is unavailable."
  }));
  return { capabilities, services, envUpdates };
}
