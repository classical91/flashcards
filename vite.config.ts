import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
  },
  preview: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT ?? "4173"),
    allowedHosts: true,
  },
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT ?? "5173"),
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
