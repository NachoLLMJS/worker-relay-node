export type WorkerJob = { id: string; prompt: string; serviceId: string };

export type WorkerCycleEvent =
  | { type: "claiming" }
  | { type: "idle" }
  | { type: "claimed"; job: WorkerJob; attemptId?: string }
  | { type: "completed"; job: WorkerJob; output: string }
  | { type: "error"; message: string };

export type WorkerJobRecord = {
  id: string;
  serviceId: string;
  prompt: string;
  output: string | null;
  state: "active" | "succeeded" | "failed";
  startedAt: string;
  completedAt: string | null;
};

export type WorkerLogRecord = {
  id: number;
  time: string;
  level: "info" | "success" | "error";
  message: string;
};

type Cycle = (input: { capabilities: string[]; acceptPublicRequests: boolean; onEvent: (event: WorkerCycleEvent) => void }) => Promise<"idle" | "completed">;

type RuntimeOptions = {
  workerId: string;
  configuredCapabilities: string[];
  initialCapabilities: string[];
  acceptPublicRequests: boolean;
  cycle: Cycle;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  idleDelayMs?: number;
  completedDelayMs?: number;
  errorDelayMs?: number;
};

export class WorkerRuntime {
  private desiredRunning = false;
  private loopActive = false;
  private connected = false;
  private busy = false;
  private completedJobs = 0;
  private failedCycles = 0;
  private lastContactAt: string | null = null;
  private startedAt: string | null = null;
  private activeCapabilities: string[];
  private acceptPublicRequests: boolean;
  private readonly jobs: WorkerJobRecord[] = [];
  private readonly logs: WorkerLogRecord[] = [];
  private logSequence = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: RuntimeOptions) {
    this.activeCapabilities = [...new Set(options.initialCapabilities)];
    this.acceptPublicRequests = options.acceptPublicRequests;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
    this.assertCapabilities(this.activeCapabilities);
    this.log("info", `Worker ${options.workerId} dashboard ready`);
  }

  start(): void {
    if (this.desiredRunning) return;
    this.desiredRunning = true;
    this.startedAt ??= this.now().toISOString();
    this.log("info", "Worker polling started");
    void this.runLoop();
  }

  stop(): void {
    if (!this.desiredRunning && !this.loopActive) return;
    this.desiredRunning = false;
    this.connected = false;
    this.log("info", "Worker stop requested; the current cycle will finish safely");
  }

  setCapabilities(capabilities: string[]): void {
    const unique = [...new Set(capabilities)];
    if (unique.length === 0) throw new Error("at least one capability must remain active");
    this.assertCapabilities(unique);
    this.activeCapabilities = unique;
    this.log("info", `Active capabilities updated: ${unique.join(", ")}`);
  }

  setAcceptPublicRequests(value: boolean): void {
    this.acceptPublicRequests = value;
    this.log("info", value ? "Anonymous public jobs enabled" : "Anonymous public jobs disabled");
  }

  snapshot() {
    return {
      workerId: this.options.workerId,
      running: this.desiredRunning || this.loopActive,
      connected: this.connected,
      busy: this.busy,
      acceptPublicRequests: this.acceptPublicRequests,
      configuredCapabilities: [...this.options.configuredCapabilities],
      activeCapabilities: [...this.activeCapabilities],
      completedJobs: this.completedJobs,
      failedCycles: this.failedCycles,
      lastContactAt: this.lastContactAt,
      startedAt: this.startedAt,
      recentJobs: this.jobs.map((job) => ({ ...job })),
      logs: this.logs.map((log) => ({ ...log }))
    };
  }

  private assertCapabilities(capabilities: string[]): void {
    for (const capability of capabilities) {
      if (!this.options.configuredCapabilities.includes(capability)) {
        throw new Error(`${capability}: capability was not validated at startup`);
      }
    }
  }

  private async runLoop(): Promise<void> {
    if (this.loopActive) return;
    this.loopActive = true;
    try {
      while (this.desiredRunning) {
        this.busy = true;
        try {
          const result = await this.options.cycle({
            capabilities: [...this.activeCapabilities],
            acceptPublicRequests: this.acceptPublicRequests,
            onEvent: (event) => this.handleEvent(event)
          });
          this.connected = true;
          this.lastContactAt = this.now().toISOString();
          this.busy = false;
          await this.sleep(result === "idle" ? (this.options.idleDelayMs ?? 5_000) : (this.options.completedDelayMs ?? 500));
        } catch (error) {
          this.busy = false;
          this.connected = false;
          this.failedCycles += 1;
          this.log("error", error instanceof Error ? error.message : String(error));
          await this.sleep(this.options.errorDelayMs ?? 10_000);
        }
      }
    } finally {
      this.busy = false;
      this.loopActive = false;
      this.connected = false;
      this.log("info", "Worker polling stopped");
    }
  }

  private handleEvent(event: WorkerCycleEvent): void {
    if (event.type === "claiming") {
      this.log("info", "Checking the coordinator for a compatible job");
      return;
    }
    if (event.type === "idle") return;
    if (event.type === "error") {
      this.log("error", event.message);
      return;
    }
    if (event.type === "claimed") {
      this.jobs.unshift({
        id: event.job.id,
        serviceId: event.job.serviceId,
        prompt: event.job.prompt,
        output: null,
        state: "active",
        startedAt: this.now().toISOString(),
        completedAt: null
      });
      this.trimJobs();
      this.log("info", `Claimed ${event.job.id.slice(0, 8)} · ${event.job.serviceId}`);
      return;
    }
    const existing = this.jobs.find((job) => job.id === event.job.id);
    const completedAt = this.now().toISOString();
    if (existing) {
      existing.state = "succeeded";
      existing.output = event.output;
      existing.completedAt = completedAt;
    } else {
      this.jobs.unshift({
        id: event.job.id,
        serviceId: event.job.serviceId,
        prompt: event.job.prompt,
        output: event.output,
        state: "succeeded",
        startedAt: completedAt,
        completedAt
      });
    }
    this.completedJobs += 1;
    this.trimJobs();
    this.log("success", `Completed ${event.job.id.slice(0, 8)} · ${event.job.serviceId}`);
  }

  private log(level: WorkerLogRecord["level"], message: string): void {
    this.logs.unshift({ id: ++this.logSequence, time: this.now().toISOString(), level, message });
    if (this.logs.length > 300) this.logs.length = 300;
  }

  private trimJobs(): void {
    if (this.jobs.length > 100) this.jobs.length = 100;
  }
}
