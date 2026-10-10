import "dotenv/config";
import { resolve } from "node:path";
import { createDashboardConfigStore } from "./config-store.js";
import { runHeadlessWorkerCycle } from "./headless-cycle.js";
import { boundedErrorMessage, installBoundedFatalErrorHandlers } from "./error-message.js";

installBoundedFatalErrorHandlers();

const configStore = createDashboardConfigStore(resolve(process.cwd(), ".env"), { ...process.env });
const once = process.argv.includes("--once");

async function cycle() {
  const { workerId, result } = await runHeadlessWorkerCycle({
    ensureWorkerIdentity: () => configStore.ensureWorkerIdentity(),
    env: process.env
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
      console.error(boundedErrorMessage(error));
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
