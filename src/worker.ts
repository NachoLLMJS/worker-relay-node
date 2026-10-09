import { z } from "zod";
import type { WorkerCycleEvent } from "./worker-runtime.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const leaseSchema = z.object({
  leaseToken: z.string().min(20),
  job: z.object({ id: z.string(), prompt: z.string().min(1), serviceId: z.string().min(3) }),
  attempt: z.object({ id: z.string().uuid() })
});

export async function runWorkerOnce(input: {
  apiUrl: string;
  workerId: string;
  workerToken: string;
  capabilities: string[];
  acceptPublicRequests?: boolean;
  onEvent?: (event: WorkerCycleEvent) => void;
  fetcher?: Fetcher;
  execute: (job: { id: string; prompt: string; serviceId: string }) => Promise<string>;
}): Promise<"idle" | "completed"> {
  const fetcher = input.fetcher ?? fetch;
  const headers = {
    authorization: `Bearer ${input.workerToken}`,
    "x-worker-id": input.workerId,
    "content-type": "application/json"
  };
  const base = input.apiUrl.replace(/\/$/, "");
  input.onEvent?.({ type: "claiming" });
  const claim = await fetcher(`${base}/api/worker/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ capabilities: input.capabilities, acceptPublicRequests: input.acceptPublicRequests ?? false })
  });
  if (claim.status === 204) {
    input.onEvent?.({ type: "idle" });
    return "idle";
  }
  if (!claim.ok) throw new Error(`claim failed (${claim.status})`);
  const parsed = leaseSchema.safeParse(await claim.json());
  if (!parsed.success) throw new Error("coordinator returned an invalid lease");
  input.onEvent?.({ type: "claimed", job: parsed.data.job, attemptId: parsed.data.attempt.id });
  const output = await input.execute(parsed.data.job);
  const completed = await fetcher(`${base}/api/worker/attempts/${parsed.data.attempt.id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ leaseToken: parsed.data.leaseToken, output })
  });
  if (!completed.ok) throw new Error(`completion failed (${completed.status})`);
  input.onEvent?.({ type: "completed", job: parsed.data.job, output });
  return "completed";
}
