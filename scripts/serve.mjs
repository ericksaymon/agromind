import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const mode = process.argv[2] === "start" ? "start" : "dev";
const root = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm || !pnpm.includes("pnpm")) throw new Error("Execute este projeto com pnpm dev ou pnpm start.");
const children = ["@agromind/api", "@agromind/web"].map(name => spawn(process.execPath, [pnpm, "--filter", name, mode], { cwd: root, stdio: "inherit", env: process.env }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
children.forEach(child => child.on("exit", code => stop(code ?? 0)));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
