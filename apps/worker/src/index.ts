const logLevel = process.env.WORKER_LOG_LEVEL ?? "info";

console.log(`[worker] ready (logLevel=${logLevel})`);

const heartbeat = setInterval(() => {
  console.log("[worker] heartbeat");
}, 60_000);

const shutdown = (signal: string) => {
  clearInterval(heartbeat);
  console.log(`[worker] shutting down on ${signal}`);
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
