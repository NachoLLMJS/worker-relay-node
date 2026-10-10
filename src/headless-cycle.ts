import { buildWorkerExecutor } from "./provider-registry.js";
import { runWorkerOnce } from "./worker.js";
import { validateCoordinatorUrl } from "./coordinator-url.js";

type WorkerExecutor = Awaited<ReturnType<typeof buildWorkerExecutor>>;
type WorkerResult = Awaited<ReturnType<typeof runWorkerOnce>>;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runHeadlessWorkerCycle(input: {
  ensureWorkerIdentity: () => Promise<{ workerId: string; workerTokenSet: boolean }>;
  env?: NodeJS.ProcessEnv;
  buildExecutor?: () => Promise<WorkerExecutor>;
  runOnce?: typeof runWorkerOnce;
}): Promise<{ workerId: string; result: WorkerResult }> {
  await input.ensureWorkerIdentity();
  const env = input.env ?? process.env;
  const apiUrl = validateCoordinatorUrl(required(env, "COORDINATOR_URL"));
  const workerToken = required(env, "WORKER_ACCESS_TOKEN");
  const workerId = required(env, "WORKER_ID");
  const acceptPublicRequests = env.ACCEPT_PUBLIC_REQUESTS?.trim().toLowerCase() === "true";
  const provider = await (input.buildExecutor ?? (() => buildWorkerExecutor(env)))();
  const result = await (input.runOnce ?? runWorkerOnce)({
    apiUrl,
    workerId,
    workerToken,
    capabilities: provider.capabilities,
    acceptPublicRequests,
    execute: provider.execute
  });
  return { workerId, result };
}
