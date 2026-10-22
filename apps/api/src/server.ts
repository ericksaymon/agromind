import { buildApp } from "./app";
import { settings } from "./config";
import { db } from "./db";
import { startAnalysisWorker } from "./analysis-service";
const app = await buildApp();
await app.listen({ port: settings.port, host: "127.0.0.1" });
const stopWorker = startAnalysisWorker(app.log);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => { await app.close(); await stopWorker(); await db.$disconnect(); process.exit(0); });
}
