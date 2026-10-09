import { z } from "zod";

type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  output_text: z.string().min(1).optional(),
  output: z.array(z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional()
  })).optional()
});

const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1).optional(), url: z.string().url().optional() })).min(1)
});

export async function generateWithOpenAI(input: {
  apiKey: string;
  model: string;
  prompt: string;
  kind?: "text" | "image";
  baseUrl?: string;
  fetcher?: Fetcher;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  const isImage = input.kind === "image";
  const response = await fetcher(`${baseUrl}${isImage ? "/v1/images/generations" : "/v1/responses"}`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(isImage
      ? { model: input.model, prompt: input.prompt, size: "1536x1024", output_format: "webp", output_compression: 85 }
      : { model: input.model, input: input.prompt }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const json = await response.json();
  if (isImage) {
    const parsed = imageResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("OpenAI returned an invalid image response");
    const image = parsed.data.data[0];
    if (!image) throw new Error("OpenAI returned no image output");
    if (image.url) return image.url;
    if (image.b64_json) return `data:image/webp;base64,${image.b64_json}`;
    throw new Error("OpenAI returned no image output");
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new Error("OpenAI returned an invalid response");
  const output = parsed.data.output_text?.trim() || parsed.data.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text" && item.text)?.text?.trim();
  if (!output) throw new Error("OpenAI returned no text output");
  return output;
}
