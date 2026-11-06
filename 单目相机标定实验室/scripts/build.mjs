import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const files = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/style.css", "style.css", "text/css; charset=utf-8"],
  ["/lab.mjs", "lab.mjs", "text/javascript; charset=utf-8"],
  ["/model.mjs", "model.mjs", "text/javascript; charset=utf-8"],
];
const assets = await Promise.all(files.map(async ([path, name, type]) => [
  path, { type, body: await readFile(new URL(`../site-assets/${name}`, import.meta.url), "utf8") },
]));
const worker = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const out = new URL("../dist/", import.meta.url);
await mkdir(new URL("server/", out), { recursive: true });
await mkdir(new URL(".openai/", out), { recursive: true });
await copyFile(new URL("../.openai/hosting.json", import.meta.url), new URL(".openai/hosting.json", out));
await writeFile(new URL("server/index.js", out), `const assets = new Map(${JSON.stringify(assets)});\n${worker}`);
