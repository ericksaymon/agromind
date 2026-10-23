import { buildApp } from "./app";
import { settings } from "./config";
import { db } from "./db";
import { startAnalysisWorker } from "./analysis-service";
import { startMailWorker } from "./mail-outbox";
const app = await buildApp();
await app.listen({ port: settings.port, host: process.env.API_HOST || "127.0.0.1" });
const stopWorker = startAnalysisWorker(app.log);
const stopMail = startMailWorker();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => { await app.close(); await stopWorker(); await stopMail(); await db.$disconnect(); process.exit(0); });
}
