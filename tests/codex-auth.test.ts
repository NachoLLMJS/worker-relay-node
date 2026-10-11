import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createCodexAuthController } from "../src/codex-auth.js";

describe("Codex dashboard authentication", () => {
  it("reports when the CLI is installed but ChatGPT sign-in is required", () => {
    const controller = createCodexAuthController({
      command: () => "codex-test",
      env: () => ({ PATH: "test-path" }),
      runSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "Not logged in" }))
    });

    expect(controller.status()).toEqual({ state: "signed_out", message: "Sign in with ChatGPT to use your subscription." });
  });

  it("reports an unavailable CLI when the status probe throws", () => {
    const controller = createCodexAuthController({
      command: () => "codex-test",
      env: () => ({ PATH: "test-path" }),
      runSync: vi.fn(() => { throw new Error("probe failed"); })
    });

    expect(controller.status()).toEqual({ state: "unavailable", message: "Codex CLI is not installed or is not available in this dashboard's PATH." });
  });

  it("starts browser sign-in without a shell and reports progress", () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    const launch = vi.fn(() => child as never);
    const controller = createCodexAuthController({
      command: () => "codex-test",
      env: () => ({ PATH: "test-path", WORKER_ACCESS_TOKEN: "secret" }),
      runSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "Not logged in" })),
      launch
    });

    expect(controller.startLogin()).toEqual({ state: "signing_in", message: "A ChatGPT sign-in page was opened in your browser." });
    expect(launch).toHaveBeenCalledWith("codex-test", ["login"], expect.objectContaining({
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: expect.not.objectContaining({ WORKER_ACCESS_TOKEN: expect.anything() })
    }));
    expect(controller.status().state).toBe("signing_in");
  });

  it("logs out and starts a fresh ChatGPT sign-in without exposing worker secrets", () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const runSync = vi.fn((_command: string, args: string[]) => args[0] === "logout"
      ? { status: 0, stdout: "", stderr: "" }
      : { status: 1, stdout: "", stderr: "Not logged in" });
    const launch = vi.fn(() => child as never);
    const controller = createCodexAuthController({
      command: () => "codex-test",
      env: () => ({ PATH: "test-path", WORKER_ACCESS_TOKEN: "secret" }),
      runSync,
      launch
    });

    expect(controller.startRelogin()).toEqual({ state: "signing_in", message: "A ChatGPT sign-in page was opened in your browser." });
    expect(runSync).toHaveBeenCalledWith("codex-test", ["logout"], expect.objectContaining({
      shell: false,
      env: expect.not.objectContaining({ WORKER_ACCESS_TOKEN: expect.anything() })
    }));
    expect(launch).toHaveBeenCalledWith("codex-test", ["login"], expect.objectContaining({ shell: false }));
  });

  it("recovers when the login process cannot be launched", () => {
    const controller = createCodexAuthController({
      command: () => "codex-test",
      env: () => ({ PATH: "test-path" }),
      runSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "Not logged in" })),
      launch: vi.fn(() => { throw new Error("launch failed"); })
    });

    expect(() => controller.startLogin()).toThrow("Codex sign-in could not start");
    expect(controller.status().state).toBe("error");
  });

  it("times out a stalled login process", () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const terminate = vi.fn();
      const controller = createCodexAuthController({
        command: () => "codex-test",
        env: () => ({ PATH: "test-path" }),
        runSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "Not logged in" })),
        launch: vi.fn(() => child as never),
        terminate,
        loginTimeoutMs: 100
      });

      controller.startLogin();
      vi.advanceTimersByTime(101);
      expect(terminate).toHaveBeenCalledWith(child);
      expect(controller.status()).toEqual({ state: "error", message: "Codex sign-in timed out. Try again." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed login process instead of silently returning to signed out", () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const controller = createCodexAuthController({
      command: () => "codex-test",
      env: () => ({ PATH: "test-path" }),
      runSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "Not logged in" })),
      launch: vi.fn(() => child as never)
    });

    controller.startLogin();
    child.emit("close", 1);
    expect(controller.status()).toEqual({ state: "error", message: "Codex sign-in did not complete. Try again." });
  });

  it("contains a process-tree termination failure", () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const controller = createCodexAuthController({
        command: () => "codex-test",
        env: () => ({ PATH: "test-path" }),
        runSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "Not logged in" })),
        launch: vi.fn(() => child as never),
        terminate: vi.fn(() => { throw new Error("terminate failed"); }),
        loginTimeoutMs: 100
      });

      controller.startLogin();
      expect(() => vi.advanceTimersByTime(101)).not.toThrow();
      expect(controller.status()).toEqual({ state: "error", message: "Codex sign-in timed out and the CLI could not be stopped. Close the dashboard before retrying." });
    } finally {
      vi.useRealTimers();
    }
  });
});
