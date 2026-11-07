#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist", "sloptube.html");
const host = "127.0.0.1";

await access(resolve(root, ".next", "BUILD_ID")).catch(() => {
  throw new Error("No production build found. Run `npm run build` first.");
});

const portServer = createServer();
await new Promise((resolveListen, reject) => {
  portServer.once("error", reject);
  portServer.listen(0, host, resolveListen);
});
const address = portServer.address();
if (!address || typeof address === "string") {
  throw new Error("Could not allocate a local port for the production server.");
}
const port = address.port;
await new Promise((resolveClose, reject) => {
  portServer.close((error) => (error ? reject(error) : resolveClose()));
});

const nextCli = resolve(root, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextCli, "start", "--hostname", host, "--port", String(port)], {
  cwd: root,
  env: { ...process.env, HOSTNAME: host, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverOutput = "";
server.stdout.setEncoding("utf8").on("data", (chunk) => { serverOutput += chunk; });
server.stderr.setEncoding("utf8").on("data", (chunk) => { serverOutput += chunk; });
const serverExit = new Promise((resolveExit) => server.once("exit", resolveExit));
const baseUrl = `http://${host}:${port}`;

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await Promise.race([serverExit, new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
}

async function fetchReadyPage() {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`The production server exited before becoming ready.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return response;
      lastError = new Error(`The production server returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for the production server: ${lastError}\n${serverOutput}`);
}

async function inlineCssAssets(css, stylesheetUrl) {
  const references = [...css.matchAll(/url\((["']?)(.*?)\1\)/gi)];
  for (const reference of references) {
    const path = reference[2].trim();
    if (!path || path.startsWith("data:") || path.startsWith("#")) continue;
    const assetUrl = new URL(path, stylesheetUrl);
    if (assetUrl.origin !== baseUrl) {
      throw new Error(`Cannot package an external stylesheet asset: ${assetUrl.href}`);
    }
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`Could not fetch stylesheet asset ${assetUrl.pathname}: HTTP ${response.status}`);
    }
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const data = Buffer.from(await response.arrayBuffer()).toString("base64");
    css = css.replace(reference[0], `url("data:${mime};base64,${data}")`);
  }
  return css;
}

try {
  const response = await fetchReadyPage();
  let html = await response.text();
  const stylesheetLinks = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)];
  for (const match of stylesheetLinks) {
    const href = match[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) throw new Error("A production stylesheet link is missing its URL.");
    const stylesheetUrl = new URL(href, baseUrl);
    if (stylesheetUrl.origin !== baseUrl) {
      throw new Error(`Cannot package an external stylesheet: ${stylesheetUrl.href}`);
    }
    const stylesheetResponse = await fetch(stylesheetUrl);
    if (!stylesheetResponse.ok) {
      throw new Error(`Could not fetch stylesheet ${stylesheetUrl.pathname}: HTTP ${stylesheetResponse.status}`);
    }
    const css = await inlineCssAssets(await stylesheetResponse.text(), stylesheetUrl);
    html = html.replace(match[0], `<style>${css}</style>`);
  }

  html = html
    .replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<link\b[^>]*rel=["'](?:preload|icon|shortcut icon)["'][^>]*>/gi, "")
    .replace(/\bhref=(["'])\/(?!\/)[^"']*\1/gi, 'href="#"');

  const notice = '<aside role="note" style="padding:10px 16px;background:#fff4ce;color:#332800;font:14px/1.45 Arial,sans-serif">Static snapshot of the actual sloptube home page. Navigation, playback, interactive features and API routes require the app server.</aside>';
  html = html.replace(/<body\b[^>]*>/i, (bodyTag) => `${bodyTag}${notice}`);

  if (!/<style>[\s\S]*<\/style>/i.test(html)) {
    throw new Error("The rendered page did not include a stylesheet to embed.");
  }
  if (/<script\b[^>]*\bsrc=|<link\b[^>]*rel=["']stylesheet|(?:src|poster)=["']\/(?!\/)|url\(["']?(?:\/|https?:)/i.test(html)) {
    throw new Error("The output still references an external script, stylesheet or asset.");
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  console.log(`Created ${output} (${Buffer.byteLength(html)} bytes)`);
} finally {
  await stopServer();
}
