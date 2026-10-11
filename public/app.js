let dashboardToken = "";
let snapshot = null;
let config = null;
let codexAuth = null;
let visualLogFloor = 0;
let poller;
let codexPoller;
let selectedSetupProvider = "chatgpt";
let setupProviderInitialized = false;
let configDirty = false;
let configSaving = false;
let publicPreferenceSaving = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const titles = { overview: "Overview", terminal: "Terminal", models: "Models", config: "Configuration", jobs: "Jobs", identity: "Identity" };

function setText(node, value) { if (node) node.textContent = value ?? ""; }
function shortId(value) { return value ? `#${value.slice(0, 8).toUpperCase()}` : "—"; }
function formatTime(value) { return value ? new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—"; }
function clip(value, limit = 90) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text || "—"; }

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (dashboardToken && path !== "/api/session") headers["x-dashboard-token"] = dashboardToken;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function showView(view) {
  $$('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; panel.classList.toggle("active", panel.dataset.viewPanel === view); });
  $$('[data-view]').forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  setText($("#page-title"), titles[view] || "Overview");
  history.replaceState(null, "", `#${view}`);
}

function terminalLine(record) {
  const line = document.createElement("div");
  line.className = `terminal-line ${record.level}`;
  const time = document.createElement("time");
  const level = document.createElement("b");
  const message = document.createElement("p");
  setText(time, formatTime(record.time));
  setText(level, record.level.toUpperCase());
  setText(message, record.message);
  line.append(time, level, message);
  return line;
}

function renderTerminal(target, limit) {
  const logs = (snapshot?.logs || []).filter((record) => record.id > visualLogFloor).slice(0, limit);
  if (!logs.length) {
    const empty = document.createElement("p"); empty.className = "terminal-empty"; setText(empty, "$ waiting for local worker events…");
    target.replaceChildren(empty);
    return;
  }
  target.replaceChildren(...logs.map(terminalLine));
}

function providerName(id) {
  const service = (config?.services || []).find((item) => item.id === id);
  if (service) return service.provider;
  if (id.includes("openai")) return "OpenAI";
  if (id.includes("anthropic")) return "Anthropic";
  if (id.includes("deepseek")) return "DeepSeek";
  if (id.includes("higgsfield")) return "Higgsfield";
  return "Local";
}

function modelName(id) {
  const service = (config?.services || []).find((item) => item.id === id);
  if (service) return service.label;
  return id.split(".").slice(2).join(" ").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Ollama";
}

function serviceDescription(id) {
  return (config?.services || []).find((item) => item.id === id)?.description || `${providerName(id)} capability`;
}

function renderModels() {
  const catalog = config?.services || [];
  const cards = catalog.map((service) => {
    const id = service.id;
    const available = service.state === "available";
    const card = document.createElement("article"); card.className = `model-card${available ? " active" : ""}`;
    const header = document.createElement("header");
    const identity = document.createElement("div");
    const title = document.createElement("h3"); const description = document.createElement("p");
    setText(title, modelName(id)); setText(description, serviceDescription(id)); identity.append(title, description);
    const mark = document.createElement("span"); mark.className = "model-provider"; setText(mark, providerName(id).slice(0, 2).toUpperCase());
    header.append(identity, mark);
    const code = document.createElement("code"); setText(code, id);
    const status = document.createElement("div"); status.className = `status ${available ? "succeeded" : "failed"}`;
    setText(status, available ? "Detected · available" : `Unavailable · ${service.reason}`);
    card.append(header, code, status);
    return card;
  });
  $("#models-grid").replaceChildren(...cards);
}

function recentJobRow(job) {
  const row = document.createElement("article"); row.className = "recent-job";
  const id = document.createElement("code"); const service = document.createElement("strong"); const prompt = document.createElement("span"); const time = document.createElement("time");
  setText(id, shortId(job.id)); setText(service, modelName(job.serviceId)); setText(prompt, clip(job.prompt)); setText(time, formatTime(job.completedAt || job.startedAt));
  row.append(id, service, prompt, time); return row;
}

function renderJobs() {
  const jobs = snapshot.recentJobs || [];
  const recent = jobs.filter((job) => job.state === "succeeded").slice(0, 4);
  const recentRoot = $("#recent-jobs");
  if (recent.length) { recentRoot.className = "recent-jobs"; recentRoot.replaceChildren(...recent.map(recentJobRow)); }
  else { recentRoot.className = "recent-jobs empty-copy"; setText(recentRoot, "No work completed on this machine yet."); }

  const rows = jobs.map((job) => {
    const tr = document.createElement("tr");
    const id = document.createElement("td"); const service = document.createElement("td"); const prompt = document.createElement("td"); const statusCell = document.createElement("td"); const completed = document.createElement("td");
    const code = document.createElement("code"); setText(code, shortId(job.id)); id.append(code);
    setText(service, job.serviceId);
    const promptCopy = document.createElement("div"); promptCopy.className = "clip"; promptCopy.title = job.prompt; setText(promptCopy, clip(job.prompt, 120)); prompt.append(promptCopy);
    const badge = document.createElement("span"); badge.className = `status ${job.state}`; setText(badge, job.state); statusCell.append(badge);
    setText(completed, formatTime(job.completedAt));
    tr.append(id, service, prompt, statusCell, completed); return tr;
  });
  $("#jobs-body").replaceChildren(...rows);
  $("#jobs-empty").hidden = rows.length > 0;
  $("#jobs-table").hidden = rows.length === 0;
}

function setInput(id, value) { const node = $(id); if (node) node.value = value ?? ""; }
function setChecked(id, value) { const node = $(id); if (node) node.checked = Boolean(value); }
function inputValue(id) { return $(id)?.value?.trim() || ""; }

function providerLabel(provider) {
  return provider === "api" ? "API provider" : provider === "local" ? "Local model" : "ChatGPT subscription";
}

function inferSetupProvider() {
  if (["chatgpt", "api", "local"].includes(config?.setupProvider)) return config.setupProvider;
  if (config?.subscriptionCliEnabled || codexAuth?.state === "ready") return "chatgpt";
  if (config?.openaiApiKeySet || config?.anthropicApiKeySet || config?.deepseekApiKeySet || config?.higgsfieldEnabled) return "api";
  if (config?.ollamaModel) return "local";
  return "chatgpt";
}

function selectSetupProvider(provider) {
  selectedSetupProvider = provider;
  $$('[data-provider-choice]').forEach((button) => {
    const selected = button.dataset.providerChoice === provider;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $$('[data-provider-pane]').forEach((pane) => { pane.hidden = pane.dataset.providerPane !== provider; });
  setText($("#activation-provider"), providerLabel(provider));
}

function setConfigSaveState(state, message = "") {
  const node = $("#config-save-state");
  if (!node) return;
  node.className = `save-state ${state}`;
  setText(node, message || (state === "dirty" ? "Unsaved changes" : state === "saving" ? "Saving…" : state === "error" ? "Not saved" : "Saved"));
}

function showConfigFeedback(message, kind = "success") {
  const node = $("#config-feedback");
  if (!node) return;
  node.hidden = !message;
  node.className = `inline-feedback ${kind}`;
  setText(node, message);
}

function markConfigDirty() {
  if (configSaving) return;
  configDirty = true;
  setConfigSaveState("dirty");
  showConfigFeedback("");
}

function setConfigActionsDisabled(disabled) {
  [$("#save-config"), $("#save-and-start")].forEach((button) => { if (button) button.disabled = disabled; });
}

function syncPublicRequestControls(value) {
  setChecked("#public-jobs-toggle", value);
  setChecked("#activation-public-jobs", value);
}

function setPublicRequestControlsDisabled(disabled) {
  [$("#public-jobs-toggle"), $("#activation-public-jobs")].forEach((control) => { if (control) control.disabled = disabled; });
}

function renderSetupSummary() {
  setText($("#activation-provider"), providerLabel(selectedSetupProvider));
  const count = snapshot?.activeCapabilities?.length || 0;
  setText($("#activation-capabilities"), count ? `${count} route${count === 1 ? "" : "s"} ready` : "No routes ready yet");
  setText($("#openai-key-state"), config?.openaiApiKeySet ? "Saved" : "Not set");
  setText($("#anthropic-key-state"), config?.anthropicApiKeySet ? "Saved" : "Not set");
  setText($("#deepseek-key-state"), config?.deepseekApiKeySet ? "Saved" : "Not set");
}

function deriveOperationalStatus() {
  if (!snapshot) return { eyebrow: "WORKER STATUS", title: "Checking readiness…", description: "Reading local providers and coordinator state.", action: "Review setup", intent: "config", tone: "neutral" };
  if (!snapshot.workerId || snapshot.workerId === "unenrolled-worker") return { eyebrow: "IDENTITY REQUIRED", title: "Worker enrollment is not ready", description: "Review the coordinator connection before starting this worker.", action: "Review setup", intent: "config", tone: "warning" };
  if (!snapshot.activeCapabilities.length) return { eyebrow: "SETUP REQUIRED", title: "Connect an AI provider to start", description: "No verified text, image, video, or local-model route is available yet.", action: "Connect provider", intent: "config", tone: "warning" };
  if (!snapshot.running) return { eyebrow: "READY", title: "Ready to start", description: `${snapshot.activeCapabilities.length} verified route${snapshot.activeCapabilities.length === 1 ? " is" : "s are"} available. Public jobs are ${snapshot.acceptPublicRequests ? "authorized" : "off"}.`, action: "Start worker", intent: "start", tone: "ready" };
  if (snapshot.busy) return { eyebrow: "ACTIVE JOB", title: "Processing a job", description: "This worker is completing the current job before accepting another one.", action: "View jobs", intent: "jobs", tone: "active" };
  if (snapshot.failedCycles && !snapshot.connected) return { eyebrow: "RETRYING", title: "Connection lost — retrying", description: "The worker is still running and will retry automatically. Open troubleshooting for technical details.", action: "Troubleshooting", intent: "terminal", tone: "error" };
  if (!snapshot.acceptPublicRequests) return { eyebrow: "RECEPTION PAUSED", title: "Public jobs are off", description: "The worker is running, but public network requests are not authorized on this machine.", action: "Review job sources", intent: "config", tone: "warning" };
  if (snapshot.connected) return { eyebrow: "ONLINE", title: "Waiting for compatible jobs", description: "The coordinator is connected. This worker will claim only jobs that match its verified routes.", action: "View providers", intent: "models", tone: "ready" };
  return { eyebrow: "CONNECTING", title: "Connecting to the coordinator", description: "Provider setup is ready. The worker is establishing its coordinator session.", action: "View details", intent: "terminal", tone: "neutral" };
}

function renderOperationalStatus() {
  const status = deriveOperationalStatus();
  const root = $("#operational-status");
  if (!root) return;
  root.className = `panel operational-card ${status.tone}`;
  setText($("#operational-eyebrow"), status.eyebrow);
  setText($("#operational-title"), status.title);
  setText($("#operational-description"), status.description);
  const action = $("#operational-action");
  setText(action, status.action);
  action.dataset.intent = status.intent;
}

function renderConfig() {
  if (!config) return;
  setInput("#cfg-worker-name", config.workerName);
  setInput("#cfg-coordinator-url", config.coordinatorUrl);
  setInput("#cfg-worker-id", config.workerId);
  setInput("#cfg-codex-command", config.codexCommand);
  setInput("#cfg-codex-model", config.codexModel);
  setInput("#cfg-ollama-model", config.ollamaModel);
  setInput("#cfg-openai-chatgpt-model", config.openaiChatgptModel);
  setInput("#cfg-openai-sol-model", config.openaiSolModel);
  setInput("#cfg-openai-image-model", config.openaiImageModel);
  setInput("#cfg-anthropic-model", config.anthropicFableModel);
  setInput("#cfg-deepseek-base-url", config.deepseekBaseUrl);
  setInput("#cfg-deepseek-flash-model", config.deepseekFlashModel);
  setInput("#cfg-deepseek-pro-model", config.deepseekProModel);
  setInput("#cfg-higgsfield-command", config.higgsfieldCommand);
  setInput("#cfg-higgsfield-genjutsu", config.higgsfieldGenjutsuModelId);
  setChecked("#cfg-subscription-enabled", config.subscriptionCliEnabled);
  setChecked("#cfg-codex-image-enabled", config.codexImageEnabled);
  setChecked("#cfg-higgsfield-enabled", config.higgsfieldEnabled);
  syncPublicRequestControls(config.acceptPublicRequests);
  if (!setupProviderInitialized) {
    selectedSetupProvider = inferSetupProvider();
    setupProviderInitialized = true;
  }
  selectSetupProvider(selectedSetupProvider);
  renderSetupSummary();
  const secrets = [config.workerId ? `open worker enrolled: ${config.workerId}` : "worker enrollment pending", config.openaiApiKeySet ? "OpenAI key saved" : "OpenAI key missing", config.anthropicApiKeySet ? "Anthropic key saved" : "Anthropic key missing", config.deepseekApiKeySet ? "DeepSeek key saved" : "DeepSeek key missing"];
  setText($("#config-message"), secrets.join(" · "));
  configDirty = false;
  setConfigSaveState("saved");
}

function renderCodexAuth() {
  const loginButton = $("#codex-login");
  const reloginButton = $("#codex-relogin");
  if (!loginButton || !reloginButton || !codexAuth) return;
  const rateLimited = codexAuth.state === "ready" && (snapshot?.logs || []).some((record) => record.message?.includes("kind=rate_limited"));
  setText($("#codex-auth-status"), rateLimited
    ? "The current ChatGPT/Codex account is rate limited. Wait for reset or relogin with another account."
    : codexAuth.message);
  loginButton.hidden = codexAuth.state === "ready";
  loginButton.disabled = codexAuth.state === "signing_in" || codexAuth.state === "unavailable";
  setText(loginButton, codexAuth.state === "signing_in" ? "Waiting for sign-in…" : codexAuth.state === "unavailable" ? "Codex CLI not found" : "Sign in with ChatGPT");
  reloginButton.hidden = codexAuth.state !== "ready";
  reloginButton.disabled = codexAuth.state === "signing_in" || codexAuth.state === "unavailable";
}

function pollCodexLogin() {
  clearInterval(codexPoller);
  if (codexAuth.state === "signing_in") {
    codexPoller = setInterval(async () => {
      await refreshCodexAuth().catch(() => {});
      if (codexAuth?.state !== "signing_in") clearInterval(codexPoller);
    }, 1_500);
  }
}

async function refreshCodexAuth() {
  codexAuth = await request("/api/codex/status");
  renderCodexAuth();
}

async function startCodexLogin() {
  codexAuth = await request("/api/codex/login", { method: "POST" });
  renderCodexAuth();
  pollCodexLogin();
}

async function startCodexRelogin() {
  if (!window.confirm("This will sign out the current Codex ChatGPT account and start a new login flow. Continue?")) return;
  codexAuth = await request("/api/codex/relogin", { method: "POST" });
  renderCodexAuth();
  pollCodexLogin();
}

async function saveConfig({ startWorker = false } = {}) {
  if (configSaving) return;
  configSaving = true;
  setConfigActionsDisabled(true);
  setConfigSaveState("saving");
  showConfigFeedback("");
  const body = {
    workerName: inputValue("#cfg-worker-name"),
    coordinatorUrl: inputValue("#cfg-coordinator-url"),
    acceptPublicRequests: $("#activation-public-jobs").checked,
    setupProvider: selectedSetupProvider,
    subscriptionCliEnabled: $("#cfg-subscription-enabled").checked,
    codexImageEnabled: $("#cfg-codex-image-enabled").checked,
    codexCommand: inputValue("#cfg-codex-command"),
    codexModel: inputValue("#cfg-codex-model"),
    ollamaModel: inputValue("#cfg-ollama-model"),
    openaiChatgptModel: inputValue("#cfg-openai-chatgpt-model"),
    openaiSolModel: inputValue("#cfg-openai-sol-model"),
    openaiImageModel: inputValue("#cfg-openai-image-model"),
    anthropicFableModel: inputValue("#cfg-anthropic-model"),
    deepseekBaseUrl: inputValue("#cfg-deepseek-base-url"),
    deepseekFlashModel: inputValue("#cfg-deepseek-flash-model"),
    deepseekProModel: inputValue("#cfg-deepseek-pro-model"),
    higgsfieldEnabled: $("#cfg-higgsfield-enabled").checked,
    higgsfieldCommand: inputValue("#cfg-higgsfield-command"),
    higgsfieldGenjutsuModelId: inputValue("#cfg-higgsfield-genjutsu")
  };
  const openaiKey = inputValue("#cfg-openai-key");
  const anthropicKey = inputValue("#cfg-anthropic-key");
  const deepseekKey = inputValue("#cfg-deepseek-key");
  if (openaiKey) body.openaiApiKey = openaiKey;
  if (anthropicKey) body.anthropicApiKey = anthropicKey;
  if (deepseekKey) body.deepseekApiKey = deepseekKey;
  try {
    config = await request("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    ["#cfg-openai-key", "#cfg-anthropic-key", "#cfg-deepseek-key"].forEach((id) => setInput(id, ""));
    await refresh();
    renderConfig();
    if (startWorker && !snapshot.running) {
      snapshot = await request("/api/worker/start", { method: "POST" });
      renderStatus();
      if (!snapshot.running) throw new Error("Worker did not enter the running state");
    }
    showConfigFeedback(startWorker ? "Worker started; provider checks continue in the background." : "Configuration saved and provider readiness refreshed.");
  } catch (error) {
    configDirty = true;
    setConfigSaveState("error");
    showConfigFeedback(error.message, "error");
    throw error;
  } finally {
    configSaving = false;
    setConfigActionsDisabled(false);
  }
}

function renderStatus() {
  if (!snapshot) return;
  setText($("#worker-id"), snapshot.workerId);
  setText($("#runtime-state"), snapshot.running ? "Running" : "Stopped");
  setText($("#activity-state"), snapshot.busy ? "Processing" : "Idle");
  setText($("#failed-cycles"), snapshot.failedCycles);
  setText($("#metric-completed"), snapshot.completedJobs);
  setText($("#metric-models"), snapshot.activeCapabilities.length);
  setText($("#metric-models-copy"), snapshot.activeCapabilities.length ? `${snapshot.activeCapabilities.length} approved routes` : "No capabilities active");
  setText($("#metric-public"), snapshot.acceptPublicRequests ? "On" : "Off");
  setText($("#metric-connection"), snapshot.connected ? "Connected" : snapshot.running ? "Connecting" : "Offline");
  setText($("#metric-contact"), snapshot.lastContactAt ? `Last contact ${formatTime(snapshot.lastContactAt)}` : "No coordinator contact");
  if (!publicPreferenceSaving) syncPublicRequestControls(snapshot.acceptPublicRequests);

  const connection = $("#connection-pill");
  connection.className = `connection-pill${snapshot.connected ? " online" : snapshot.failedCycles ? " error" : ""}`;
  setText(connection.querySelector("span"), snapshot.connected ? "Coordinator connected" : snapshot.running ? "Connecting…" : "Worker stopped");
  const toggle = $("#worker-toggle");
  toggle.className = `primary-action${snapshot.running ? " stop" : ""}`;
  setText(toggle, snapshot.running ? "Stop worker" : "Start worker");

  renderTerminal($("#overview-terminal"), 8);
  renderTerminal($("#terminal-feed"), 300);
  renderModels();
  renderJobs();
  renderCodexAuth();
  renderOperationalStatus();
  renderSetupSummary();
}

async function refresh() {
  snapshot = await request("/api/status");
  renderStatus();
}

async function savePublicPreference(value) {
  if (publicPreferenceSaving) {
    syncPublicRequestControls(snapshot?.acceptPublicRequests || false);
    return;
  }
  publicPreferenceSaving = true;
  setPublicRequestControlsDisabled(true);
  syncPublicRequestControls(value);
  try {
    config = await request("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acceptPublicRequests: value }) });
    snapshot = await request("/api/status");
    syncPublicRequestControls(snapshot.acceptPublicRequests);
    renderStatus();
    if (configDirty) setConfigSaveState("dirty");
    else setConfigSaveState("saved", "Public job preference saved");
    showConfigFeedback(`Public requests ${snapshot.acceptPublicRequests ? "enabled" : "disabled"}.`, "success");
  } catch (error) {
    syncPublicRequestControls(snapshot?.acceptPublicRequests || false);
    if (configDirty) setConfigSaveState("dirty");
    else setConfigSaveState("error");
    showConfigFeedback(error.message, "error");
  } finally {
    publicPreferenceSaving = false;
    setPublicRequestControlsDisabled(false);
  }
}


$$('[data-view]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$('[data-jump]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.jump)));
$$('[data-provider-choice]').forEach((button) => button.addEventListener("click", () => { selectSetupProvider(button.dataset.providerChoice); markConfigDirty(); }));
$$('#view-config input:not([readonly]):not(#activation-public-jobs)').forEach((input) => input.addEventListener("input", markConfigDirty));
$("#worker-toggle").addEventListener("click", async () => { snapshot = await request(snapshot.running ? "/api/worker/stop" : "/api/worker/start", { method: "POST" }); renderStatus(); });
$("#operational-action").addEventListener("click", async (event) => {
  const intent = event.currentTarget.dataset.intent;
  if (intent === "start") { snapshot = await request("/api/worker/start", { method: "POST" }); renderStatus(); return; }
  showView(intent || "config");
});
$("#save-config").addEventListener("click", () => saveConfig().catch(() => {}));
$("#save-and-start").addEventListener("click", () => saveConfig({ startWorker: true }).catch(() => {}));
$("#codex-login").addEventListener("click", () => startCodexLogin().catch((error) => showConfigFeedback(error.message, "error")));
$("#codex-relogin").addEventListener("click", () => startCodexRelogin().catch((error) => showConfigFeedback(error.message, "error")));
$("#public-jobs-toggle").addEventListener("change", (event) => savePublicPreference(event.target.checked));
$("#activation-public-jobs").addEventListener("change", (event) => savePublicPreference(event.target.checked));

$("#clear-terminal").addEventListener("click", () => { visualLogFloor = Math.max(0, ...(snapshot.logs || []).map((log) => log.id)); renderStatus(); });
window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "overview"));

(async () => {
  dashboardToken = (await request("/api/session")).token;
  config = await request("/api/config").catch(() => null);
  await Promise.all([refresh(), refreshCodexAuth()]);
  renderConfig();
  showView(titles[location.hash.slice(1)] ? location.hash.slice(1) : "overview");
  poller = setInterval(() => refresh().catch(() => {}), 1_000);
})().catch((error) => {
  const connection = $("#connection-pill"); connection.className = "connection-pill error"; setText(connection.querySelector("span"), error.message);
});

window.addEventListener("beforeunload", () => { clearInterval(poller); clearInterval(codexPoller); });
