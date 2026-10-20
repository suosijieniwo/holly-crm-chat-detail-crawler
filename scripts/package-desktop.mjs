import { build } from "electron-builder";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
await build({ projectDir: root, config: path.join(root, "electron-builder.yml"), publish: "never" });
