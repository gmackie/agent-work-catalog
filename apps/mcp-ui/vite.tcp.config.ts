import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins:[viteSingleFile()],
  build:{outDir:"dist-tcp",emptyOutDir:true,minify:true,cssMinify:true,
    rollupOptions:{input:fileURLToPath(new URL("./tcp-report.html",import.meta.url))}},
});
