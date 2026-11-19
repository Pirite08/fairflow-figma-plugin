import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const path = (name) => fileURLToPath(new URL(name, import.meta.url));
const output = path("./build/");
await mkdir(output, { recursive: true });
const [productionHTML, toolbar, driver] = await Promise.all([
  readFile(path("../ui.html"), "utf8"),
  readFile(path("./toolbar.html"), "utf8"),
  readFile(path("./panel.js"), "utf8"),
]);
const html = productionHTML
  .replace(/<body>/i, (match) => match + toolbar)
  .replace(
    /<\/body>/i,
    (match) => "<script>\n" + driver + "\n</script>\n" + match,
  );
if (html === productionHTML || !html.includes(driver))
  throw Error("Unexpected production panel structure.");
await build({
  entryPoints: [path("./runner.js")],
  outfile: path("./build/code.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  charset: "utf8",
});
const product = JSON.parse(await readFile(path("../manifest.json"), "utf8"));
const manifest = {
  ...product,
  name: "FairFlow Desktop QA",
  id: "fairflow-qa-native-runner",
  main: "code.js",
  ui: "ui.html",
};
await Promise.all([
  writeFile(path("./build/ui.html"), html),
  writeFile(
    path("./build/manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
]);
console.log(path("./build/manifest.json"));
