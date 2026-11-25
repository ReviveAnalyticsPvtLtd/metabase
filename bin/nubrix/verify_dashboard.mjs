// Uses installed Chrome and Node APIs; no browser automation dependency.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const [sessionFile, outputDirectory] = process.argv.slice(2);
assert(sessionFile && outputDirectory, "Pass session JSON path and output directory");
const { id: session } = JSON.parse(await readFile(sessionFile, "utf8"));
const profile = await mkdtemp(join(outputDirectory, "chrome-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${profile}`],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
);
let nextId = 0;
let buffer = "";
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      if (message.error) {
        callback.reject(new Error(JSON.stringify(message.error)));
      } else {
        callback.resolve(message.result);
      }
    }
  }
});
const watchdog = setTimeout(() => chrome.kill(), 100000);
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
}
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable");
  await call("Network.enable");
  await call("Runtime.enable");
  await call("Log.enable");
  await call("Network.setExtraHTTPHeaders", { headers: { "X-Metabase-Session": session } });
  await call("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: "https://mstar.nubrixai.com/dashboard/17" });
  await delay(90000);
  const result = await call("Runtime.evaluate", { expression: "({title:document.title,url:location.href,text:document.body.innerText,markers:document.querySelectorAll('.leaflet-marker-icon').length})", returnByValue: true });
  const page = result.result.value;
  await writeFile(join(outputDirectory, "browser-dashboard.json"), JSON.stringify({ ...page, events: pending.size }, null, 2));
  const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(outputDirectory, "dashboard.png"), Buffer.from(screenshot.data, "base64"));
  assert(page.text.includes("Keg Demand & Inventory") || /^https:\/\/mstar\.nubrixai\.com\/dashboard\/17(?:\?|$)/.test(page.url), "Dashboard did not load");
  assert(!page.url.includes("/auth/login"), "Login redirect");
  console.log(JSON.stringify({ title: page.title, url: page.url, markers: page.markers, text: page.text.slice(0, 5000) }, null, 2));
} finally {
  clearTimeout(watchdog);
  chrome.kill();
}
