import { z } from "zod";
import type { WorkerCycleEvent } from "./worker-runtime.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const jobSchema = z.object({
  id: z.string(),
  prompt: z.string().min(1),
  serviceId: z.string().min(3).optional(),
  serviceIds: z.array(z.string().min(3)).min(1).optional(),
  requirements: z.array(z.enum(["text", "image", "video"])).min(1).optional()
}).refine((job) => Boolean(job.serviceId || job.serviceIds?.length), "job must select at least one service").transform((job) => ({
  ...job,
  serviceId: job.serviceIds?.[0] || job.serviceId!
}));

const leaseSchema = z.object({
  leaseToken: z.string().min(20),
  job: jobSchema,
  serviceIds: z.array(z.string().min(3)).min(1).optional(),
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
  execute: (job: { id: string; prompt: string; serviceId: string; serviceIds?: string[] }) => Promise<string>;
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
  const serviceIds = parsed.data.serviceIds ?? parsed.data.job.serviceIds;
  if (!serviceIds?.length || new Set(serviceIds).size !== serviceIds.length) throw new Error("coordinator returned an invalid lease");
  if (serviceIds.some((serviceId) => !input.capabilities.includes(serviceId))) throw new Error("coordinator returned an unapproved service");
  if (parsed.data.job.requirements?.some((requirement) => !serviceIds.some((serviceId) => serviceId.startsWith(`${requirement}.`)))) {
    throw new Error("coordinator returned an invalid lease");
  }
  const selectedJob = {
    ...parsed.data.job,
    serviceIds
  };
  input.onEvent?.({ type: "claimed", job: selectedJob, attemptId: parsed.data.attempt.id });
  const output = await input.execute(selectedJob);
  const completed = await fetcher(`${base}/api/worker/attempts/${parsed.data.attempt.id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ leaseToken: parsed.data.leaseToken, output })
  });
  if (!completed.ok) throw new Error(`completion failed (${completed.status})`);
  input.onEvent?.({ type: "completed", job: selectedJob, output });
  return "completed";
}
