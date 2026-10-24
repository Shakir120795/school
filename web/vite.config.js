import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:4000",
      "/schools": "http://localhost:4000",
      "/attendance": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
});
