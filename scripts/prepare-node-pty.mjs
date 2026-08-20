import { chmodSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

if (process.platform !== "win32") {
  const requireFromBridge = createRequire(
    new URL("../packages/bridge/package.json", import.meta.url),
  );
  let packageJson;
  try {
    packageJson = requireFromBridge.resolve("node-pty/package.json");
  } catch (error) {
    // The Foundry root workspace installs this package before the nested mobile
    // workspace. Its later component install reruns this hook with node-pty present.
    if (error?.code !== "MODULE_NOT_FOUND") throw error;
  }

  if (packageJson) {
    const packageRoot = dirname(packageJson);
    const helper = join(
      packageRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );
    if (existsSync(helper)) {
      chmodSync(helper, statSync(helper).mode | 0o111);
    }
  }
}
