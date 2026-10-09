export type ServiceKind = "text" | "image" | "video";

export interface ServiceDefinition {
  id: string;
  label: string;
  kind: ServiceKind;
  provider: "Local" | "OpenAI" | "Anthropic" | "DeepSeek" | "Higgsfield";
  description: string;
  executor: "ollama" | "openai" | "anthropic" | "deepseek" | "higgsfield" | "codex-cli" | "claude-code-cli";
  modelId?: string;
  configurableModel?: string;
}

const services = [
  {
    id: "text.ollama",
    label: "Ollama / local model",
    kind: "text",
    provider: "Local",
    description: "Runs on the worker computer without a hosted-model account.",
    executor: "ollama",
    configurableModel: "OLLAMA_MODEL"
  },
  {
    id: "text.openai.chatgpt",
    label: "ChatGPT",
    kind: "text",
    provider: "OpenAI",
    description: "General hosted text and reasoning through the OpenAI Responses API.",
    executor: "openai",
    modelId: "gpt-5.4-mini",
    configurableModel: "OPENAI_CHATGPT_MODEL"
  },
  {
    id: "text.openai.codex",
    label: "Codex subscription",
    kind: "text",
    provider: "OpenAI",
    description: "Text-only coding and reasoning through a locally authenticated Codex CLI and ChatGPT plan.",
    executor: "codex-cli",
    configurableModel: "CODEX_MODEL"
  },
  {
    id: "text.openai.sol",
    label: "OpenAI Sol",
    kind: "text",
    provider: "OpenAI",
    description: "Low-latency conversational model through the OpenAI Responses API.",
    executor: "openai",
    modelId: "openai-sol-2026-07-20",
    configurableModel: "OPENAI_SOL_MODEL"
  },
  {
    id: "text.anthropic.fable",
    label: "Claude Fable",
    kind: "text",
    provider: "Anthropic",
    description: "Fast conversational model through the Anthropic Messages API.",
    executor: "anthropic",
    modelId: "claude-fable-4-6",
    configurableModel: "ANTHROPIC_FABLE_MODEL"
  },
  {
    id: "text.anthropic.claude-code",
    label: "Claude Code subscription",
    kind: "text",
    provider: "Anthropic",
    description: "Text-only coding and reasoning through a locally authenticated Claude Code CLI and Claude plan.",
    executor: "claude-code-cli",
    configurableModel: "CLAUDE_CODE_MODEL"
  },
  {
    id: "text.deepseek.flash",
    label: "DeepSeek Flash",
    kind: "text",
    provider: "DeepSeek",
    description: "Fast hosted text and agent tasks through the official DeepSeek API.",
    executor: "deepseek",
    modelId: "deepseek-flash",
    configurableModel: "DEEPSEEK_FLASH_MODEL"
  },
  {
    id: "text.deepseek.v4-pro",
    label: "DeepSeek V4 Pro",
    kind: "text",
    provider: "DeepSeek",
    description: "Higher-capability hosted reasoning through the official DeepSeek API.",
    executor: "deepseek",
    modelId: "deepseek-v4-pro",
    configurableModel: "DEEPSEEK_PRO_MODEL"
  },
  {
    id: "image.openai.gpt-image-2",
    label: "GPT Image 2",
    kind: "image",
    provider: "OpenAI",
    description: "Native OpenAI image generation with the worker operator's OpenAI account.",
    executor: "openai",
    modelId: "gpt-image-2",
    configurableModel: "OPENAI_IMAGE_MODEL"
  },
  {
    id: "image.higgsfield.nano-banana-2",
    label: "Nano Banana 2",
    kind: "image",
    provider: "Higgsfield",
    description: "Fast character, cartoon and general image generation.",
    executor: "higgsfield",
    modelId: "nano_banana_flash"
  },
  {
    id: "image.higgsfield.seedream-5-pro",
    label: "Seedream 5.0 Pro",
    kind: "image",
    provider: "Higgsfield",
    description: "Faces, character sheets and complex image edits.",
    executor: "higgsfield",
    modelId: "seedream_v5_pro"
  },
  {
    id: "image.higgsfield.recraft-4.1",
    label: "Recraft V4.1",
    kind: "image",
    provider: "Higgsfield",
    description: "Logos, icons and controlled vector-style graphics.",
    executor: "higgsfield",
    modelId: "recraft_v4_1"
  },
  {
    id: "video.higgsfield.seedance-2.5",
    label: "Seedance 2.5",
    kind: "video",
    provider: "Higgsfield",
    description: "Cinematic prompt-to-video generation up to 1080p.",
    executor: "higgsfield",
    modelId: "seedance_2_5"
  },
  {
    id: "video.higgsfield.genjutsu",
    label: "Genjutsu",
    kind: "video",
    provider: "Higgsfield",
    description: "Visual-effects generation; the worker operator supplies the current Higgsfield model ID.",
    executor: "higgsfield",
    configurableModel: "HIGGSFIELD_GENJUTSU_MODEL_ID"
  },
  {
    id: "video.higgsfield.kling-3-turbo",
    label: "Kling 3.0 Turbo",
    kind: "video",
    provider: "Higgsfield",
    description: "Fast prompt-to-video option for simpler motion.",
    executor: "higgsfield",
    modelId: "kling3_0_turbo"
  }
] as const satisfies readonly ServiceDefinition[];

const byId = new Map<string, ServiceDefinition>(services.map((service) => [service.id, service]));

export function listServices(): ServiceDefinition[] {
  return services.map((service) => ({ ...service }));
}

export function getService(id: string): ServiceDefinition | undefined {
  const service = byId.get(id);
  return service ? { ...service } : undefined;
}

export function requireService(id: string): ServiceDefinition {
  const service = getService(id);
  if (!service) throw new Error("unsupported service");
  return service;
}
