import { context } from "esbuild";
import path from "node:path";
import fs from "node:fs/promises";
import { sourceLoader } from "./scripts/source-loader.mjs";

const build = await context({
  absWorkingDir: path.resolve("."),
  entryPoints: [path.resolve("src/main.ts")],
  tsconfigRaw: {},
  bundle: true,
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  format: "cjs",
  target: "es2018",
  platform: "browser",
  outfile: "main.js",
  write: false,
  plugins: [sourceLoader(), {
    name: "write-plugin",
    setup(build) {
      build.onEnd(async (result) => {
        if (!result.errors.length) {
          await fs.writeFile("main.js", result.outputFiles[0].contents);
        }
      });
    }
  }],
  logLevel: "info",
  minify: !process.argv.includes("--watch"),
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  banner: { js: "/* AI Contributions | MIT License | Built from src/main.ts */" }
});

if (process.argv.includes("--watch")) {
  await build.watch();
} else {
  await build.rebuild();
  await build.dispose();
}
