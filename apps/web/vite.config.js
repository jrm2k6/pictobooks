import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const docsDir = path.resolve(import.meta.dirname, "../../docs");

// Serves docs/ files from the dev server so api-story.html has same-origin
// access to window.Clerk for automatic token retrieval.
const devDocsPlugin = clerkPublishableKey => ({
  name: "dev-docs",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const name = req.url?.split("?")[0].replace(/^\//, "");
      if (!name) return next();
      const filePath = path.join(docsDir, name);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
        return next();
      if (!/\.(html|yaml|yml|md|css|js|png|svg|ico)$/.test(name)) return next();

      const ext = path.extname(name).slice(1);
      const types = {
        html: "text/html",
        yaml: "text/yaml",
        yml: "text/yaml",
        md: "text/markdown",
        css: "text/css",
        js: "application/javascript",
      };
      res.setHeader("Content-Type", types[ext] || "application/octet-stream");

      // Inject Clerk publishable key into HTML docs so they can auto-authenticate
      if (ext === "html") {
        let html = fs.readFileSync(filePath, "utf-8");
        html = html.replace(
          "</head>",
          `<script>window.__CLERK_PK__=${JSON.stringify(clerkPublishableKey)};</script>\n</head>`
        );
        res.end(html);
      } else {
        fs.createReadStream(filePath).pipe(res);
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  return {
    plugins: [react(), devDocsPlugin(env.VITE_CLERK_PUBLISHABLE_KEY ?? "")],
  };
});
