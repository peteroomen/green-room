import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { handle } from "./server/handlers.ts";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "APP_PASSWORD",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_MODEL",
  ])
    if (env[key]) process.env[key] = env[key];
  return {
    plugins: [
      react(),
      tailwind(),
      {
        name: "local-api",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const kind = req.url
              ?.split("?")[0]
              .match(/^\/api\/(config|session|coach|opponent)$/)?.[1];
            if (!kind) return next();
            let body = "";
            for await (const part of req) {
              body += part;
              if (body.length > 150000) {
                res.statusCode = 413;
                res.end("Request too large");
                return;
              }
            }
            try {
              const request = Object.assign(req, {
                body: body ? JSON.parse(body) : {},
              });
              const response = Object.assign(res, {
                status(n: number) {
                  res.statusCode = n;
                  return response;
                },
                json(data: unknown) {
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify(data));
                  return response;
                },
              });
              await handle(
                kind as Parameters<typeof handle>[0],
                request as never,
                response as never,
              );
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid request" }));
            }
          });
        },
      },
    ],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    server: { allowedHosts: ["terminal.local"] },
  };
});
