import fs from "node:fs/promises";
import path from "node:path";

// Resolve our small source tree through Node. This also works in Windows
// sandboxes where esbuild's native process cannot enumerate parent folders.
export function sourceLoader() {
  return {
    name: "project-source",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind !== "entry-point" && !args.path.startsWith(".") && !path.isAbsolute(args.path)) {
          return { path: args.path, external: true };
        }
        let file = path.resolve(args.resolveDir || process.cwd(), args.path);
        if (!path.extname(file)) file += ".ts";
        return { path: file, namespace: "project-source" };
      });
      build.onLoad({ filter: /.*/, namespace: "project-source" }, async (args) => ({
        contents: await fs.readFile(args.path, "utf8"),
        loader: args.path.endsWith(".ts") ? "ts" : "js",
        resolveDir: path.dirname(args.path),
        watchFiles: [args.path]
      }));
    }
  };
}
