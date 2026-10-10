import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { WorkerRuntime } from "./worker-runtime.js";
import type { DashboardConfigSummary, DashboardConfigUpdate } from "./config-store.js";
import type { CodexAuthController } from "./codex-auth.js";

type DashboardConfigStore = {
  summary(): Promise<DashboardConfigSummary>;
  save(update: DashboardConfigUpdate): Promise<DashboardConfigSummary>;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function writeJson(reply: ServerResponse, status: number, body: unknown): void {
  reply.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  reply.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 64_000) throw new Error("request_too_large");
  }
  return body ? JSON.parse(body) : {};
}

function safeHost(request: IncomingMessage): boolean {
  const host = request.headers.host?.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function safeMutationOrigin(request: IncomingMessage): boolean {
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.origin;
  if (origin) return origin === `http://${request.headers.host}`;
  return fetchSite === "same-origin" || fetchSite === "none";
}

export async function buildDashboardServer(options: { runtime: WorkerRuntime; publicDir: string; configStore?: DashboardConfigStore; codexAuth?: CodexAuthController; onConfigSaved?: (summary: DashboardConfigSummary) => void }) {
  const token = randomBytes(32).toString("base64url");
  const server = createServer(async (request, reply) => {
    reply.setHeader("x-content-type-options", "nosniff");
    reply.setHeader("x-frame-options", "DENY");
    reply.setHeader("referrer-policy", "no-referrer");
    reply.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

    if (!safeHost(request)) return writeJson(reply, 403, { error: "forbidden_host" });
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/session") return writeJson(reply, 200, { token });
    if (request.method === "GET" && url.pathname === "/api/status") return writeJson(reply, 200, options.runtime.snapshot());
    if (request.method === "GET" && url.pathname === "/api/codex/status") {
      if (request.headers["x-dashboard-token"] !== token) return writeJson(reply, 403, { error: "forbidden" });
      if (!options.codexAuth) return writeJson(reply, 404, { error: "not_found" });
      return writeJson(reply, 200, options.codexAuth.status());
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      if (!options.configStore) return writeJson(reply, 404, { error: "not_found" });
      return writeJson(reply, 200, await options.configStore.summary());
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      if (!safeMutationOrigin(request)) return writeJson(reply, 403, { error: "forbidden_origin" });
      if (request.headers["x-dashboard-token"] !== token) return writeJson(reply, 403, { error: "forbidden" });
      try {
        if (url.pathname === "/api/config") {
          if (!options.configStore) return writeJson(reply, 404, { error: "not_found" });
          const summary = await options.configStore.save(await readJson(request) as DashboardConfigUpdate);
          options.onConfigSaved?.(summary);
          return writeJson(reply, 200, summary);
        }
        if (url.pathname === "/api/codex/login") {
          if (!options.codexAuth) return writeJson(reply, 404, { error: "not_found" });
          return writeJson(reply, 202, options.codexAuth.startLogin());
        }
        if (url.pathname === "/api/worker/start") await options.runtime.start();
        else if (url.pathname === "/api/worker/stop") options.runtime.stop();
        else if (url.pathname === "/api/worker/public-requests") {
          const body = await readJson(request) as { enabled?: unknown };
          if (typeof body.enabled !== "boolean") return writeJson(reply, 400, { error: "invalid_setting" });
          options.runtime.setAcceptPublicRequests(body.enabled);
        } else return writeJson(reply, 404, { error: "not_found" });
        return writeJson(reply, 200, options.runtime.snapshot());
      } catch {
        return writeJson(reply, 400, { error: "invalid_request" });
      }
    }

    if (request.method !== "GET") return writeJson(reply, 405, { error: "method_not_allowed" });
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const file = join(options.publicDir, normalized);
    if (!file.startsWith(normalize(options.publicDir))) return writeJson(reply, 404, { error: "not_found" });
    try {
      const content = await readFile(file);
      reply.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      reply.end(content);
    } catch {
      writeJson(reply, 404, { error: "not_found" });
    }
  });

  return {
    token,
    listen(port = 4317, host = "127.0.0.1"): Promise<string> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : port;
          resolve(`http://${host}:${actualPort}`);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
