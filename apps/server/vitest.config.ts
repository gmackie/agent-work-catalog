import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
/**
 * Node-based unit tests cannot import Cloudflare's runtime-only module.
 * This alias is exclusive to Vitest; Wrangler deploy bundles the real class.
 */
export default defineConfig({
  resolve:{alias:{
    "cloudflare:workers":fileURLToPath(new URL("./test/cloudflare-workers-mock.ts",import.meta.url))
  }}
});
