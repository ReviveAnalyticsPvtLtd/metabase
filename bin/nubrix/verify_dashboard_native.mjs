// Native CDP browser test using Google Chrome and Node.js built-ins (zero dependencies)
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const outputDirectory = process.argv[2] || "/Users/apple/.gemini/antigravity-cli/brain/0753bba2-3ead-4236-85f4-9df6a0252281";
const BASE = (process.env.BASE_URL || "https://mstar.nubrixai.com").replace(/\/+$/, "");
const DASHBOARD_ID = process.env.DASHBOARD_ID || "23";
const MIN_PINS = Number(process.env.MIN_PINS || "50");
const REQUIRE_CUSTOM_LEGEND = process.env.REQUIRE_CUSTOM_LEGEND !== "false";

// Authenticate via fetch (requires METABASE_SESSION_TOKEN or METABASE_ADMIN_EMAIL + METABASE_ADMIN_PASSWORD)
let sessionToken = process.env.METABASE_SESSION_TOKEN || "";
if (!sessionToken) {
  const email = process.env.METABASE_ADMIN_EMAIL;
  const password = process.env.METABASE_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("Missing METABASE_SESSION_TOKEN or METABASE_ADMIN_EMAIL/METABASE_ADMIN_PASSWORD env vars.");
  }
  console.log("Authenticating with Metabase API...");
  const authRes = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password }),
  });
  const authData = await authRes.json();
  sessionToken = authData.id;
}
console.log("Session token obtained:", sessionToken ? sessionToken.slice(0, 8) : "ERROR");

const profile = await mkdtemp(join("/tmp", "chrome-mstar-"));
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
        if (message.method === "Runtime.consoleAPICalled") {
          console.log("Browser console:", message.params.type, message.params.args.map(a => a.value || a.description).join(" "));
        } else if (message.method === "Runtime.exceptionThrown") {
          console.log("Browser exception:", JSON.stringify(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text));
        }
      }
    } catch (e) {
      console.error("CDP parse error:", e);
    }
  }
});

const watchdog = setTimeout(() => {
  console.error("Watchdog timed out after 180s");
  chrome.kill();
  process.exit(1);
}, 180000);

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

  // Set session cookie
  await call("Network.setCookie", {
    name: "metabase.SESSION",
    value: sessionToken,
    url: BASE,
    path: "/",
    httpOnly: true,
    secure: BASE.startsWith("https"),
  });

  await call("Network.setExtraHTTPHeaders", {
    headers: { "X-Metabase-Session": sessionToken },
  });

  await call("Emulation.setDeviceMetricsOverride", {
    width: 1680,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const dashUrl = `${BASE}/dashboard/${DASHBOARD_ID}?carrier=&customer=&customer_type=&region=`;
  console.log(`Navigating to ${dashUrl}...`);
  await call("Page.navigate", { url: dashUrl });

  console.log("Waiting for dashboard queries and Leaflet markers to render (adaptive polling up to 120s)...");
  const startTime = Date.now();
  let page = {};

  while (Date.now() - startTime < 120000) {
    const evalResult = await call("Runtime.evaluate", {
      expression: `({
        title: document.title,
        url: location.href,
        dashcards: document.querySelectorAll('[data-testid="dashcard"]').length,
        customPins: document.querySelectorAll('.nubrix-custom-pin-marker').length,
        allMarkers: document.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive').length,
        hasLegend: document.querySelectorAll('.nubrix-map-legend').length > 0,
        hasTable: document.querySelectorAll('table, [role="grid"], .TableInteractive').length > 0 || (document.body.innerText || '').includes('Alloc_ID'),
        bodyTextLen: (document.body.innerText || '').length,
        loadingSpinners: document.querySelectorAll('.Loading-spinner, [data-testid="loading-indicator"]').length
      })`,
      returnByValue: true,
    });

    page = evalResult.result?.value || {};
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[+${elapsed}s] Dashcards: ${page.dashcards}, Pins: ${page.customPins}, Markers: ${page.allMarkers}, Legend: ${page.hasLegend}, Table: ${page.hasTable}, URL: ${page.url}`);

    if (page.url && page.url.includes("/auth/login")) {
      throw new Error("Redirected to login page. Session cookie was not accepted.");
    }

    // Check if dashcards and pins have rendered
    if (page.dashcards >= 5 && (page.customPins >= MIN_PINS || page.allMarkers >= MIN_PINS) && page.hasTable) {
      console.log(`All ${page.dashcards} dashcards and ${page.customPins || page.allMarkers} pins rendered successfully!`);
      await delay(4000);
      break;
    }

    await delay(3000);
  }

  // Final inspect before loaded screenshot
  const finalEval = await call("Runtime.evaluate", {
    expression: `({
      title: document.title,
      url: location.href,
      dashcards: document.querySelectorAll('[data-testid="dashcard"]').length,
      customPins: document.querySelectorAll('.nubrix-custom-pin-marker').length,
      allMarkers: document.querySelectorAll('.leaflet-marker-icon').length,
      hasLegend: document.querySelectorAll('.nubrix-map-legend').length > 0,
      hasTable: document.querySelectorAll('table, [role="grid"], .TableInteractive').length > 0 || (document.body.innerText || '').includes('Alloc_ID'),
      tableSnippet: ((Array.from(document.querySelectorAll('[data-testid="dashcard"]')).find(el => el.innerText.includes('Alloc_ID')) || {}).innerText || '').slice(0, 600),
      text: document.body.innerText.slice(0, 1000),
    })`,
    returnByValue: true,
  });
  page = finalEval.result?.value || page;

  // Capture initial loaded screenshot
  console.log("Capturing loaded overview screenshot...");
  const initialScreenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(outputDirectory, "dashboard-23-loaded.png"), Buffer.from(initialScreenshot.data, "base64"));
  console.log("Saved dashboard-23-loaded.png");
  await delay(2500);

  // Simulate clicking the 5th map pin marker to test cross-filter dispatch
  console.log("Simulating click on a map pin marker to test cross-filter dispatch...");
  const clickSuccess = await call("Runtime.evaluate", {
    expression: `(() => {
      const pins = document.querySelectorAll('.nubrix-custom-pin-marker');
      if (pins.length > 5) {
        pins[5].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { clicked: true, pinIndex: 5, totalPins: pins.length };
      }
      const markers = document.querySelectorAll('.leaflet-marker-icon');
      if (markers.length > 5) {
        markers[5].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { clicked: true, pinIndex: 5, totalMarkers: markers.length };
      }
      return { clicked: false, totalPins: pins.length, totalMarkers: markers.length };
    })()`,
    returnByValue: true,
  });
  console.log("Pin marker click dispatched:", JSON.stringify(clickSuccess.result?.value));

  console.log("Waiting for crossfilter state and query refresh...");
  await delay(8000);

  // Check URL and state after click
  const postClickResult = await call("Runtime.evaluate", {
    expression: `({
      url: location.href,
      dashcards: document.querySelectorAll('[data-testid="dashcard"]').length,
      pins: document.querySelectorAll('.nubrix-custom-pin-marker').length,
      markers: document.querySelectorAll('.leaflet-marker-icon').length,
      tableSnippet: ((Array.from(document.querySelectorAll('[data-testid="dashcard"]')).find(el => el.innerText.includes('Alloc_ID')) || {}).innerText || '').slice(0, 600),
      text: document.body.innerText.slice(0, 1000),
    })`,
    returnByValue: true,
  });

  const postState = postClickResult.result?.value || {};
  console.log("State after pin click:", JSON.stringify(postState));

  // Capture cross-filtered screenshot (without captureBeyondViewport so DOM stays mounted)
  console.log("Capturing crossfiltered screenshot...");
  const crossScreenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outputDirectory, "dashboard-23-crossfiltered.png"), Buffer.from(crossScreenshot.data, "base64"));
  console.log("Saved dashboard-23-crossfiltered.png");

  // Assertions
  assert(!page.url.includes("/auth/login"), "Redirected to login");
  assert(page.dashcards >= 5, `Expected >= 5 dashcards, got ${page.dashcards}`);
  assert(page.customPins >= MIN_PINS || page.allMarkers >= MIN_PINS, `Expected >= ${MIN_PINS} pins rendered, got ${page.customPins || page.allMarkers}`);
  if (REQUIRE_CUSTOM_LEGEND) {
    assert(page.hasLegend, "Expected .nubrix-map-legend to be present on map");
  }
  assert(page.text.includes("Simulated India MVP"), "Expected banner to disclose Simulated India MVP");
  assert(page.text.includes("1,000"), "Expected banner to disclose 1,000-order horizon");
  assert(page.text.includes("No Real Bookings"), "Expected banner to disclose No Real Bookings/Reservations");
  assert(!/real-time/i.test(page.text), "Banner/page must not contain 'real-time' claim");
  assert(postState.url !== page.url, `Expected URL filter params to change after pin click (${postState.url})`);
  assert(postState.tableSnippet && postState.tableSnippet !== page.tableSnippet, "Expected filtered table data to change after pin click");

  // Click an Order_ID cell in Card 142 to verify Card 147 (Selected Order Plan & Candidate Alternatives)
  console.log("Simulating click on an Order_ID cell in Card 142...");
  const orderClickRes = await call("Runtime.evaluate", {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="dashcard"]'));
      const card142 = cards.find(el => (el.innerText || '').includes('Alloc_ID'));
      if (!card142) return { clicked: false, reason: 'no card142', cardCount: cards.length, titles: cards.map(c => (c.innerText || '').split('\\n')[0]) };
      const cell = Array.from(card142.querySelectorAll('[role="gridcell"], td, span, div, a, button')).find(el => /^ORD-\\d{6}$/.test((el.textContent || '').trim()));
      if (!cell) return { clicked: false, reason: 'no ORD cell', snippet: card142.innerText.slice(0, 300) };
      const orderId = cell.textContent.trim();
      cell.scrollIntoView({ block: 'center' });
      cell.click();
      return { clicked: true, orderId };
    })()`,
    returnByValue: true,
  });
  const clickedOrder = orderClickRes.result?.value || {};
  console.log("Order cell click dispatched:", JSON.stringify(clickedOrder));
  assert(clickedOrder.clicked && clickedOrder.orderId, "Expected to click an ORD- cell in Card 142");
  await delay(6000);

  const evidenceEval = await call("Runtime.evaluate", {
    expression: `(() => {
      const card147 = Array.from(document.querySelectorAll('[data-testid="dashcard"]')).find(el => el.innerText.includes('Selected Order Plan & Candidate Alternatives'));
      return {
        url: location.href,
        evidenceText: card147 ? card147.innerText.slice(0, 800) : '',
      };
    })()`,
    returnByValue: true,
  });
  const evState = evidenceEval.result?.value || {};
  console.log("State after order click:", JSON.stringify(evState));
  assert(evState.url.includes(`order_id=${clickedOrder.orderId}`), `Expected URL to contain order_id=${clickedOrder.orderId}, got ${evState.url}`);
  assert(evState.evidenceText.includes(clickedOrder.orderId), `Expected Card 147 to display ${clickedOrder.orderId}`);
  assert(evState.evidenceText.includes("Selected") || evState.evidenceText.includes("Rejected"), "Expected Card 147 to show Selected/Rejected candidate decisions");

  console.log("=== Native Browser Verification Succeeded! ===");
} finally {
  clearTimeout(watchdog);
  chrome.kill();
}
