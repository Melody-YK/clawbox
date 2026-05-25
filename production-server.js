const { spawn } = require("node:child_process");

const host = process.env.HOSTNAME || "0.0.0.0";
const port = process.env.PORT || "80";

// Avoid relying on .next/standalone/server.js because it may be missing/empty
// in field deployments. Start Next directly from installed package.
const nextCli = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextCli, "start", "--hostname", host, "--port", port], {
  cwd: __dirname,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
