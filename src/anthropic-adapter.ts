import { z } from "zod";

type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }))
});

export async function generateWithAnthropic(input: {
  apiKey: string;
  model: string;
  prompt: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`${(input.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 2_048,
      messages: [{ role: "user", content: input.prompt }]
    }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`Anthropic request failed (${response.status})`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Anthropic returned an invalid response");
  const output = parsed.data.content.find((item) => item.type === "text" && item.text)?.text?.trim();
  if (!output) throw new Error("Anthropic returned no text output");
  return output;
}
