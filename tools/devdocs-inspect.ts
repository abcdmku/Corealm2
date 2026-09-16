import { chromium } from "playwright";

/*
  Print boxes and computed styles for elements on a devdocs route, for layout debugging.
    npx tsx tools/devdocs-inspect.ts items/catalog/crown_trout "aside" --base http://127.0.0.1:4192
*/

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] ?? fallback : fallback; };
const positional = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1]!.startsWith("--")));
const [route = "", selector = "body"] = positional;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: Number(option("width", "1440")), height: 1000 } });
  await page.addInitScript("globalThis.__name = (t) => t;");
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${option("base", "http://127.0.0.1:4190")}/#/${route}`, { waitUntil: "load" });
  await page.waitForTimeout(Number(option("wait", "3000")));
  const report = await page.evaluate((sel) => Array.from(document.querySelectorAll<HTMLElement>(sel)).slice(0, 8).map(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { tag: element.tagName.toLowerCase(), className: element.className.toString().slice(0, 160), box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], display: style.display, children: element.children.length, html: element.innerHTML.slice(0, 300) };
  }), selector);
  console.log(JSON.stringify({ report, errors: errors.slice(0, 10) }, null, 2));
  await browser.close();
}

void main();
