import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "site");
const url = process.env.SUPABASE_URL?.trim() || "";
const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || "";
const requireCloud = process.argv.includes("--require-cloud");

if (Boolean(url) !== Boolean(anonKey)) {
  throw new Error("SUPABASE_URL과 SUPABASE_ANON_KEY를 함께 설정해주세요.");
}
if (requireCloud && (!url || !anonKey)) {
  throw new Error(
    "배포 빌드에는 SUPABASE_URL과 SUPABASE_ANON_KEY가 필요합니다.",
  );
}
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  throw new Error("SUPABASE_URL 형식을 확인해주세요.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ["index.html", "styles.css"]) {
  await cp(resolve(root, "dist", name), resolve(output, name));
}
await build({
  entryPoints: [resolve(root, "dist", "app.js")],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outdir: output,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
});
const htmlPath = resolve(output, "index.html");
const html = await readFile(htmlPath, "utf8");
if (!html.includes('src="./runtime-config.js"')) {
  await writeFile(
    htmlPath,
    html.replace(
      '<script type="module" src="./app.js"></script>',
      '<script src="./runtime-config.js"></script>\n    <script type="module" src="./app.js"></script>',
    ),
  );
}
await writeFile(
  resolve(output, "runtime-config.js"),
  `window.GRAD_DASH_CONFIG=Object.freeze(${JSON.stringify({ url, anonKey })});\n`,
);
await writeFile(resolve(output, ".nojekyll"), "");
console.log(`Built ${output}${url ? " with shared database configuration" : " (local-only mode)"}`);
