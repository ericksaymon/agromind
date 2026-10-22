import { buildApp } from "./app";
import { settings } from "./config";
import { db } from "./db";
const app = await buildApp();
await app.listen({ port: settings.port, host: "127.0.0.1" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => { await app.close(); await db.$disconnect(); process.exit(0); });
}
