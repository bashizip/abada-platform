import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  return {
    server: {
      port: 5603,
      host: "0.0.0.0",
      strictPort: true,
      hmr: {
        host: "orun.localhost",
        protocol: "ws",
        clientPort: 80,
      },
      allowedHosts: ["orun.localhost", "localhost"],
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
