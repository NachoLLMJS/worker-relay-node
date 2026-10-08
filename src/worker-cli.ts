import "dotenv/config";
import { buildWorkerExecutor } from "./provider-registry.js";
import { runWorkerOnce } from "./worker.js";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiUrl = required("COORDINATOR_URL");
const workerToken = required("WORKER_ACCESS_TOKEN");
const workerId = process.env.WORKER_NAME?.trim() || "friend-worker-1";
const provider = buildWorkerExecutor();
const once = process.argv.includes("--once");

async function cycle() {
  const result = await runWorkerOnce({
    apiUrl,
    workerId,
    workerToken,
    capabilities: provider.capabilities,
    execute: provider.execute
  });
  console.log(JSON.stringify({ time: new Date().toISOString(), workerId, result }));
  return result;
}

if (once) {
  await cycle();
} else {
  while (true) {
    try {
      const result = await cycle();
      await new Promise((resolve) => setTimeout(resolve, result === "idle" ? 5_000 : 500));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
