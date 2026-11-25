import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

console.log("Checking Chrome connectivity to https://mstar.nubrixai.com...");

const profile = await mkdtemp(join("/tmp", "chrome-diag-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
  ],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
);

let nextId = 0;
let buffer = "";
const pending = new Map();

chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const message = JSON.parse(raw);
      if (message.id) {
        const callback = pending.get(message.id);
        if (callback) {
          pending.delete(message.id);
          if (message.error) {
            callback.reject(new Error(JSON.stringify(message.error)));
          } else {
            callback.resolve(message.result);
          }
        }
      } else if (message.method) {
        if (message.method === "Network.loadingFailed") {
          console.log("Network.loadingFailed:", message.params.requestId, message.params.errorText);
        } else if (message.method === "Network.responseReceived") {
          console.log("Network.responseReceived:", message.params.response.url, message.params.response.status);
        } else if (message.method === "Runtime.consoleAPICalled") {
          console.log("Console:", message.params.type, message.params.args.map(a => a.value || a.description).join(" "));
        } else if (message.method === "Runtime.exceptionThrown") {
          console.log("Exception:", JSON.stringify(message.params.exceptionDetails));
        }
      }
    } catch (e) {
      console.error("Parse error:", e);
    }
  }
});

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

  const nav = await call("Page.navigate", { url: "https://mstar.nubrixai.com" });
  console.log("Nav result:", JSON.stringify(nav));

  await delay(8000);

  const evalRes = await call("Runtime.evaluate", {
    expression: "({ title: document.title, htmlLen: document.documentElement.outerHTML.length, bodyText: document.body.innerText })",
    returnByValue: true,
  });
  console.log("Eval:", JSON.stringify(evalRes.result.value));
} finally {
  chrome.kill();
}
