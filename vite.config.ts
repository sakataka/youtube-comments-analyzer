import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname
      }
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: {
        "/api": env.VITE_BACKEND_URL || "http://127.0.0.1:8000"
      }
    },
    preview: {
      host: "127.0.0.1",
      port: 0
    }
  };
});
