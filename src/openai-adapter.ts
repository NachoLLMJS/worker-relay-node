import { z } from "zod";

type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  output_text: z.string().min(1).optional(),
  output: z.array(z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional()
  })).optional()
});

export async function generateWithOpenAI(input: {
  apiKey: string;
  model: string;
  prompt: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`${(input.baseUrl ?? "https://api.openai.com").replace(/\/$/, "")}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: input.model, input: input.prompt }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("OpenAI returned an invalid response");
  const output = parsed.data.output_text?.trim() || parsed.data.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text" && item.text)?.text?.trim();
  if (!output) throw new Error("OpenAI returned no text output");
  return output;
}
