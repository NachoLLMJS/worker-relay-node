import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncReturns } from "node:child_process";
import { resolveSubscriptionCliInvocation, subscriptionCliEnvironment, subscriptionCliIsLoggedIn } from "./subscription-cli-adapter.js";

export type CodexAuthStatus = {
  state: "ready" | "signed_out" | "signing_in" | "unavailable" | "error";
  message: string;
};

type RunSync = (command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => Pick<SpawnSyncReturns<string>, "status" | "stdout" | "stderr" | "error">;
type Launch = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type Terminate = (child: ChildProcess) => void;

function terminateProcessTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
    const result = spawnSync(`${systemRoot}\\System32\\taskkill.exe`, ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
    if (result.status === 0) return;
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {}
  }
  child.kill();
}

export function createCodexAuthController(options: {
  command?: () => string;
  env?: () => NodeJS.ProcessEnv;
  runSync?: RunSync;
  launch?: Launch;
  terminate?: Terminate;
  loginTimeoutMs?: number;
} = {}) {
  const command = options.command ?? (() => process.env.CODEX_COMMAND?.trim() || "codex");
  const sourceEnv = options.env ?? (() => process.env);
  const runSync = options.runSync ?? ((executable, args, spawnOptions) => spawnSync(executable, args, spawnOptions) as SpawnSyncReturns<string>);
  const launch = options.launch ?? spawn;
  const terminate = options.terminate ?? terminateProcessTree;
  const loginTimeoutMs = options.loginTimeoutMs ?? 10 * 60_000;
  let loginInProgress = false;
  let lastError = "";

  function probeStatus(): CodexAuthStatus {
    let result: ReturnType<RunSync>;
    try {
      const env = subscriptionCliEnvironment(sourceEnv());
      const invocation = resolveSubscriptionCliInvocation(command(), env);
      result = runSync(invocation.command, [...invocation.argsPrefix, "login", "status"], {
        env,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: 30_000
      });
    } catch {
      return { state: "unavailable", message: "Codex CLI is not installed or is not available in this dashboard's PATH." };
    }
    if (result.error) return { state: "unavailable", message: "Codex CLI is not installed or is not available in this dashboard's PATH." };
    const stdout = String(result.stdout || "");
    const stderr = String(result.stderr || "");
    if (result.status === 0 && subscriptionCliIsLoggedIn("codex", stdout, stderr)) {
      return { state: "ready", message: "Signed in with ChatGPT. Your Codex subscription is ready." };
    }
    return { state: "signed_out", message: "Sign in with ChatGPT to use your subscription." };
  }

  function status(): CodexAuthStatus {
    if (loginInProgress) return { state: "signing_in", message: "Complete ChatGPT sign-in in the browser window." };
    if (lastError) return { state: "error", message: lastError };
    return probeStatus();
  }

  function startLogin(): CodexAuthStatus {
    if (loginInProgress) return { state: "signing_in", message: "Complete ChatGPT sign-in in the browser window." };
    const current = probeStatus();
    if (current.state === "ready") return current;
    if (current.state === "unavailable") throw new Error(current.message);

    lastError = "";
    let child: ChildProcess;
    try {
      const env = subscriptionCliEnvironment(sourceEnv());
      const invocation = resolveSubscriptionCliInvocation(command(), env);
      child = launch(invocation.command, [...invocation.argsPrefix, "login"], {
        env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      loginInProgress = true;
    } catch (error) {
      loginInProgress = false;
      lastError = `Codex sign-in could not start: ${error instanceof Error ? error.message : "unknown error"}`;
      throw new Error(lastError);
    }
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (message = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      loginInProgress = false;
      lastError = message;
    };
    child.once("error", (error) => {
      finish(`Codex sign-in could not start: ${error.message}`);
    });
    child.once("close", (code) => {
      if (code !== 0) {
        finish("Codex sign-in did not complete. Try again.");
        return;
      }
      finish(probeStatus().state === "ready" ? "" : "Codex sign-in did not complete. Try again.");
    });
    timeout = setTimeout(() => {
      finish("Codex sign-in timed out. Try again.");
      try {
        terminate(child);
      } catch {
        lastError = "Codex sign-in timed out and the CLI could not be stopped. Close the dashboard before retrying.";
      }
    }, loginTimeoutMs);
    return { state: "signing_in", message: "A ChatGPT sign-in page was opened in your browser." };
  }

  return { status, startLogin };
}

export type CodexAuthController = ReturnType<typeof createCodexAuthController>;
