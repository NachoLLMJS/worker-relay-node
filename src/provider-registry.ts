import { detectWorkerCapabilities, type DetectionDependencies } from "./capability-detector.js";
import { generateWithAnthropic } from "./anthropic-adapter.js";
import { generateWithDeepSeek } from "./deepseek-adapter.js";
import { generateWithHiggsfield } from "./higgsfield-adapter.js";
import { generateWithOllama } from "./ollama-adapter.js";
import { generateWithOpenAI } from "./openai-adapter.js";
import { requireService } from "./service-catalog.js";
import { generateWithCodexSubscription, type CliRunner } from "./subscription-cli-adapter.js";

type Env = Record<string, string | undefined>;
export type WorkerJob = { id: string; prompt: string; serviceId: string; serviceIds?: string[] };
type Dependencies = DetectionDependencies & { codexRunner?: CliRunner };

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the detected worker capability`);
  return value;
}

function higgsfieldArgs(serviceId: string): string[] {
  switch (serviceId) {
    case "image.higgsfield.nano-banana-2": return ["--aspect_ratio", "1:1"];
    case "image.higgsfield.seedream-5-pro": return ["--aspect_ratio", "1:1", "--resolution", "2k"];
    case "image.higgsfield.recraft-4.1": return ["--aspect_ratio", "1:1", "--model_type", "vector"];
    case "video.higgsfield.seedance-2.5": return ["--mode", "t2v", "--duration", "5", "--resolution", "720p", "--aspect_ratio", "16:9"];
    case "video.higgsfield.kling-3-turbo": return ["--duration", "5", "--resolution", "720p", "--aspect_ratio", "16:9"];
    case "video.higgsfield.genjutsu": return [];
    default: throw new Error("unsupported Higgsfield service");
  }
}

export async function executeSelectedServices(job: WorkerJob, executeOne: (serviceId: string) => Promise<string>): Promise<string> {
  const selected = [...new Set(job.serviceIds?.length ? job.serviceIds : [job.serviceId])];
  if (selected.length === 1) return executeOne(selected[0]!);
  const services = await Promise.all(selected.map(async (serviceId) => ({ serviceId, output: await executeOne(serviceId) })));
  return JSON.stringify({ services });
}

export async function buildWorkerExecutor(env: Env = process.env, dependencies: Dependencies = {}) {
  const detection = await detectWorkerCapabilities(env, dependencies);
  const capabilities = detection.capabilities;
  if (!capabilities.length) throw new Error("no provider capabilities are currently ready");
  for (const [key, value] of Object.entries(detection.envUpdates)) env[key] = value;

  async function executeOne(job: WorkerJob, serviceId: string): Promise<string> {
    if (!capabilities.includes(serviceId)) throw new Error(`${serviceId}: worker received an unapproved service`);
    const service = requireService(serviceId);
    switch (service.executor) {
      case "ollama":
        return generateWithOllama({ baseUrl: env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434", model: required(env, "OLLAMA_MODEL"), prompt: job.prompt });
      case "openai":
        return generateWithOpenAI({ apiKey: required(env, "OPENAI_API_KEY"), model: (service.configurableModel && env[service.configurableModel]?.trim()) || service.modelId!, kind: service.kind === "image" ? "image" : "text", baseUrl: env.OPENAI_BASE_URL?.trim(), prompt: job.prompt });
      case "anthropic":
        return generateWithAnthropic({ apiKey: required(env, "ANTHROPIC_API_KEY"), model: (service.configurableModel && env[service.configurableModel]?.trim()) || service.modelId!, baseUrl: env.ANTHROPIC_BASE_URL?.trim(), prompt: job.prompt });
      case "deepseek":
        return generateWithDeepSeek({ apiKey: required(env, "DEEPSEEK_API_KEY"), model: (service.configurableModel && env[service.configurableModel]?.trim()) || service.modelId!, baseUrl: env.DEEPSEEK_BASE_URL?.trim(), prompt: job.prompt });
      case "codex-cli":
        return generateWithCodexSubscription({ command: env.CODEX_COMMAND?.trim() || "codex", model: env.CODEX_MODEL?.trim(), prompt: job.prompt, sourceEnv: env, runner: dependencies.codexRunner });
      case "higgsfield": {
        const modelId = serviceId === "video.higgsfield.genjutsu" ? required(env, "HIGGSFIELD_GENJUTSU_MODEL_ID") : service.modelId!;
        return generateWithHiggsfield({ modelId, prompt: job.prompt, args: higgsfieldArgs(serviceId), command: env.HIGGSFIELD_COMMAND?.trim() || "higgsfield", sourceEnv: env });
      }
    }
  }

  async function execute(job: WorkerJob): Promise<string> {
    return executeSelectedServices(job, (serviceId) => executeOne(job, serviceId));
  }

  return { capabilities, services: detection.services, envUpdates: detection.envUpdates, execute };
}