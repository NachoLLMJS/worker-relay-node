import { z } from "zod";

export async function generateWithOllama(input: {
  baseUrl: string;
  model: string;
  prompt: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`${input.baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, stream: false }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`ollama request failed (${response.status})`);
  const parsed = z.object({ response: z.string().min(1) }).safeParse(await response.json());
  if (!parsed.success) throw new Error("ollama returned an invalid response");
  return parsed.data.response.trim();
}
