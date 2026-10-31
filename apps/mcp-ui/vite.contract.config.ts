import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins:[viteSingleFile()],
  build:{
    outDir:"dist-contract",emptyOutDir:true,minify:true,cssMinify:true,
    rollupOptions:{input:fileURLToPath(new URL("./contract.html",import.meta.url))},
  },
});
