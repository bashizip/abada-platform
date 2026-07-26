import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5602,
    proxy: {
      "/api": {
        target: "http://api.localhost",
        changeOrigin: true,
        secure: true,
      },
      "/auth": {
        target: "http://keycloak.localhost",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/auth/, ""),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
