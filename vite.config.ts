import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx, ManifestV3Export } from "@crxjs/vite-plugin";
import path from "path";
const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "Simple.Biz Call Coach",
  version: "2.0.0",
  description: "Real-time AI-powered call coaching with AWS Lambda backend, conversation intelligence, and Developer Mode for offline testing",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  permissions: [
    "tabCapture",
    "activeTab",
    "storage",
    "offscreen",
    "sidePanel",
    "tabs",
  ],
  host_permissions: [
    "*://*.calltools.io/*",
    "http://localhost:8080/*",
    "ws://localhost:8080/*"
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["*://*.calltools.io/*"],
      js: ["src/content/index.ts"],
      run_at: "document_start",
    },
  ],
  action: {
    default_popup: "src/popup/popup.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/sidepanel.html",
  },
  web_accessible_resources: [
    {
      resources: [
        "src/offscreen/offscreen.html",
        "src/offscreen/audio-worklet-processor.js",
        "src/injected/webrtc-interceptor.ts",
        "src/injected/audio-processor.ts"
      ],
      matches: ["*://*.calltools.io/*"],
    },
  ],
};
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        offscreen: path.resolve(__dirname, "src/offscreen/offscreen.html"),
        permissions: path.resolve(__dirname, "src/permissions.html"),
      },
    },
  },
});
