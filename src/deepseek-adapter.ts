import { z } from "zod";

type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) })
  })).min(1)
});

export async function generateWithDeepSeek(input: {
  apiKey: string;
  model: string;
  prompt: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: input.prompt }],
      stream: false
    }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`DeepSeek request failed (${response.status})`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("DeepSeek returned an invalid response");
  const output = parsed.data.choices[0]?.message.content.trim();
  if (!output) throw new Error("DeepSeek returned no text output");
  return output;
}
