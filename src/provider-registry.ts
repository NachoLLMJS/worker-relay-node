import { generateWithAnthropic } from "./anthropic-adapter.js";
import { generateWithDeepSeek } from "./deepseek-adapter.js";
import { generateWithHiggsfield } from "./higgsfield-adapter.js";
import { generateWithOllama } from "./ollama-adapter.js";
import { generateWithOpenAI } from "./openai-adapter.js";
import { requireService } from "./service-catalog.js";
import {
  assertSubscriptionCliReady,
  generateWithClaudeCodeSubscription,
  generateWithCodexSubscription,
  type CliRunner,
  type SubscriptionProbe
} from "./subscription-cli-adapter.js";

type Env = Record<string, string | undefined>;
type WorkerJob = { id: string; prompt: string; serviceId: string };
type Dependencies = { codexRunner?: CliRunner; claudeCodeRunner?: CliRunner; subscriptionProbe?: SubscriptionProbe };

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected worker capabilities`);
  return value;
}

function higgsfieldArgs(serviceId: string): string[] {
  switch (serviceId) {
    case "image.higgsfield.nano-banana-2":
      return ["--aspect_ratio", "1:1"];
    case "image.higgsfield.seedream-5-pro":
      return ["--aspect_ratio", "1:1", "--resolution", "2k"];
    case "image.higgsfield.recraft-4.1":
      return ["--aspect_ratio", "1:1", "--model_type", "vector"];
    case "video.higgsfield.seedance-2.5":
      return ["--mode", "t2v", "--duration", "5", "--resolution", "720p", "--aspect_ratio", "16:9"];
    case "video.higgsfield.kling-3-turbo":
      return ["--duration", "5", "--resolution", "720p", "--aspect_ratio", "16:9"];
    case "video.higgsfield.genjutsu":
      return [];
    default:
      throw new Error("unsupported Higgsfield service");
  }
}

export function buildWorkerExecutor(env: Env = process.env, dependencies: Dependencies = {}) {
  const configured = env.WORKER_CAPABILITIES?.split(",").map((value) => value.trim()).filter(Boolean) ?? ["text.ollama"];
  const capabilities = [...new Set(configured)];
  if (capabilities.length === 0) throw new Error("WORKER_CAPABILITIES must select at least one service");
  const subscriptionEnabled = env.SUBSCRIPTION_CLI_ENABLED?.trim().toLowerCase() === "true";
  const subscriptionProbe = dependencies.subscriptionProbe ?? assertSubscriptionCliReady;
  const checkedSubscriptionClis = new Set<string>();

  for (const capability of capabilities) {
    const service = requireService(capability);
    if (service.executor === "openai") required(env, "OPENAI_API_KEY");
    if (service.executor === "anthropic") required(env, "ANTHROPIC_API_KEY");
    if (service.executor === "deepseek") required(env, "DEEPSEEK_API_KEY");
    if (service.executor === "codex-cli" || service.executor === "claude-code-cli") {
      if (!subscriptionEnabled) throw new Error("SUBSCRIPTION_CLI_ENABLED=true is required for subscription CLI capabilities");
      const kind = service.executor === "codex-cli" ? "codex" : "claude-code";
      const command = service.executor === "codex-cli"
        ? (env.CODEX_COMMAND?.trim() || "codex")
        : (env.CLAUDE_CODE_COMMAND?.trim() || "claude");
      if (!checkedSubscriptionClis.has(kind)) {
        subscriptionProbe(kind, command, env);
        checkedSubscriptionClis.add(kind);
      }
    }
    if (service.executor === "higgsfield") {
      if (env.HIGGSFIELD_ENABLED?.trim().toLowerCase() !== "true") {
        throw new Error("HIGGSFIELD_ENABLED=true is required for Higgsfield capabilities");
      }
      if (capability === "video.higgsfield.genjutsu") required(env, "HIGGSFIELD_GENJUTSU_MODEL_ID");
    }
  }

  async function execute(job: WorkerJob): Promise<string> {
    if (!capabilities.includes(job.serviceId)) throw new Error("worker received an unapproved service");
    const service = requireService(job.serviceId);
    switch (service.executor) {
      case "ollama":
        return generateWithOllama({
          baseUrl: env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
          model: env.OLLAMA_MODEL?.trim() || "llama3.2",
          prompt: job.prompt
        });
      case "openai":
        return generateWithOpenAI({
          apiKey: required(env, "OPENAI_API_KEY"),
          model: (service.configurableModel && env[service.configurableModel]?.trim()) || service.modelId!,
          kind: service.kind === "image" ? "image" : "text",
          baseUrl: env.OPENAI_BASE_URL?.trim(),
          prompt: job.prompt
        });
      case "anthropic":
        return generateWithAnthropic({
          apiKey: required(env, "ANTHROPIC_API_KEY"),
          model: (service.configurableModel && env[service.configurableModel]?.trim()) || service.modelId!,
          baseUrl: env.ANTHROPIC_BASE_URL?.trim(),
          prompt: job.prompt
        });
      case "deepseek":
        return generateWithDeepSeek({
          apiKey: required(env, "DEEPSEEK_API_KEY"),
          model: (service.configurableModel && env[service.configurableModel]?.trim()) || service.modelId!,
          baseUrl: env.DEEPSEEK_BASE_URL?.trim(),
          prompt: job.prompt
        });
      case "codex-cli":
        return generateWithCodexSubscription({
          command: env.CODEX_COMMAND?.trim() || "codex",
          model: env.CODEX_MODEL?.trim(),
          prompt: job.prompt,
          sourceEnv: env,
          runner: dependencies.codexRunner
        });
      case "claude-code-cli":
        return generateWithClaudeCodeSubscription({
          command: env.CLAUDE_CODE_COMMAND?.trim() || "claude",
          model: env.CLAUDE_CODE_MODEL?.trim(),
          prompt: job.prompt,
          sourceEnv: env,
          runner: dependencies.claudeCodeRunner
        });
      case "higgsfield": {
        const modelId = job.serviceId === "video.higgsfield.genjutsu"
          ? required(env, "HIGGSFIELD_GENJUTSU_MODEL_ID")
          : service.modelId!;
        return generateWithHiggsfield({
          modelId,
          prompt: job.prompt,
          args: higgsfieldArgs(job.serviceId),
          command: env.HIGGSFIELD_COMMAND?.trim() || "higgsfield"
        });
      }
    }
  }

  return { capabilities, execute };
}
