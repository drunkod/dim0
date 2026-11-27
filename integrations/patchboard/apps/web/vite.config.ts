import { defineConfig } from "vite";
import { foldkit } from "@foldkit/vite-plugin";

const jazzPort = Number(process.env.PATCHBOARD_JAZZ_PORT ?? "3001");
const jazzProxy = { target: `http://127.0.0.1:${jazzPort}`, ws: true };

export default defineConfig({
  base: process.env.PATCHBOARD_WEB_BASE ?? "/",
  plugins: [foldkit()],
  server: { port: 5173, strictPort: true, proxy: { "/jazz": jazzProxy } },
  preview: { proxy: { "/jazz": jazzProxy } },
});
