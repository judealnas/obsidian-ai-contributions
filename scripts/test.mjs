import { build } from "esbuild";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { sourceLoader } from "./source-loader.mjs";

await mkdir(".test-build", { recursive: true });
const outputs = [];
for (const file of (await readdir("tests")).filter((name) => name.endsWith(".test.mjs"))) {
  const output = path.resolve(".test-build", file.replace(/\.mjs$/, ".cjs"));
  const result = await build({
    entryPoints: [path.resolve("tests", file)],
    bundle: true, format: "cjs", platform: "node", target: "node22",
    tsconfigRaw: {}, write: false, plugins: [{
      name: "obsidian-test-double",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({
          path: path.resolve("tests/helpers/obsidian.mjs"), namespace: "project-source"
        }));
      }
    }, sourceLoader()]
  });
  await writeFile(output, result.outputFiles[0].contents);
  outputs.push(output);
}
if (!outputs.length) throw new Error("No tests found.");
const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit" });
process.exit(result.status ?? 1);
