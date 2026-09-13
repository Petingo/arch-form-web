import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const browserPort = Number(process.argv[2] || 9222);
const pageOrigin = process.argv[3] || "http://localhost:4173";
const outputRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/model-references");
// Every design that has spatial grounding, straight from the manifest, so this
// stays in step with data/extracted/spatial_manifest.json.
const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/extracted/spatial_manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const modelIds = process.argv[5]?.split(",").filter(Boolean)
  || manifest.flatMap((competition) => competition.entries);

// "isometric_marked" renders the isometric view with the critique markers drawn
// on it -- that is what the competition index shows on each card.
const views = process.argv[4]?.split(",").filter(Boolean) || ["isometric_marked"];
const viewUrl = (modelId, view) => view === "isometric_marked"
  ? `${pageOrigin}/arch-form-web/web/tools/reference.html?model=${modelId}&view=isometric&markers=1`
  : `${pageOrigin}/arch-form-web/web/tools/reference.html?model=${modelId}&view=${view}`;

const pages = await fetch(`http://127.0.0.1:${browserPort}/json/list`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.startsWith("http"));
if (!page) throw new Error("No inspectable browser page found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 30000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await evaluate("document.body?.dataset?.ready || ''");
    if (state === "true") return;
    if (state === "error") throw new Error("Reference renderer reported an error");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Reference renderer did not become ready");
}

await send("Emulation.setDeviceMetricsOverride", { width: 768, height: 768, deviceScaleFactor: 1, mobile: false });
for (const modelId of modelIds) {
  const modelDir = path.join(outputRoot, modelId);
  fs.mkdirSync(modelDir, { recursive: true });
  for (const view of views) {
    const target = path.join(modelDir, `${view}.png`);
    if (process.env.SKIP_EXISTING === "1" && fs.existsSync(target)) { continue; }
    await send("Page.navigate", { url: viewUrl(modelId, view) });
    await waitUntilReady();
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(target, Buffer.from(screenshot.data, "base64"));
    console.log(`${modelId} ${view}`);
  }
}

socket.close();
console.log(`Saved calibrated references to ${outputRoot}`);
