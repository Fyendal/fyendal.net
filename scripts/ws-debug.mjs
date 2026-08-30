import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", args: ["--no-proxy-server"] });
const page = await browser.newPage();
page.on("console", (m) => console.log("CONSOLE:", m.text()));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:5173");
const result = await page.evaluate(() => new Promise((res) => {
  const ws = new WebSocket("ws://localhost:8080");
  const out = [];
  ws.onopen = () => { out.push("open"); ws.close(); res(out); };
  ws.onerror = (e) => { out.push("error"); };
  ws.onclose = (e) => { out.push("close:" + e.code + ":" + e.reason); res(out); };
  setTimeout(() => res(out.concat("timeout")), 4000);
}));
console.log("WS TEST:", JSON.stringify(result));
await browser.close();
