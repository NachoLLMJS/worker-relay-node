export function validateCoordinatorUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.includes("?") || raw.includes("#")) {
    throw new Error("Coordinator URL must not contain query strings or fragments");
  }
  const coordinator = new URL(raw);
  if (coordinator.username || coordinator.password || coordinator.search || coordinator.hash) {
    throw new Error("Coordinator URL must not contain credentials, query strings, or fragments");
  }
  const loopback = coordinator.hostname === "127.0.0.1" || coordinator.hostname === "localhost" || coordinator.hostname === "::1";
  if (coordinator.protocol !== "https:" && !(loopback && coordinator.protocol === "http:")) {
    throw new Error("Coordinator URL must use HTTPS");
  }
  return coordinator.toString().replace(/\/$/, "");
}