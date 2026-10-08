import { spawn } from "node:child_process";

type Runner = (command: string, args: string[]) => Promise<string>;

const defaultRunner: Runner = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("Higgsfield generation timed out"));
  }, 30 * 60_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.length > 1_000_000) child.kill();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 100_000) child.kill();
  });
  child.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0) return reject(new Error(`Higgsfield generation failed (${code}): ${stderr.trim().slice(0, 500)}`));
    resolve(stdout);
  });
});

function findUrl(value: unknown): string | undefined {
  if (typeof value === "string" && /^https:\/\//.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrl(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findUrl(item);
      if (found) return found;
    }
  }
  return undefined;
}

export async function generateWithHiggsfield(input: {
  modelId: string;
  prompt: string;
  args?: string[];
  command?: string;
  runner?: Runner;
}): Promise<string> {
  const args = ["generate", "create", input.modelId, "--prompt", input.prompt, ...(input.args ?? []), "--wait", "--json"];
  const stdout = await (input.runner ?? defaultRunner)(input.command ?? "higgsfield", args);
  try {
    const url = findUrl(JSON.parse(stdout));
    if (url) return url;
  } catch {
    const match = stdout.match(/https:\/\/[^\s"']+/);
    if (match) return match[0];
  }
  throw new Error("Higgsfield completed without a media URL");
}
