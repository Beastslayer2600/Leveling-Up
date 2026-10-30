import type { Plugin } from "vite";
import { defineConfig } from "vite";

/** Dev only: answer /api/* from server/dev.ts so sign-in and sync work under `npm run dev`. */
function devApi(): Plugin {
  return {
    name: "leveling-up:dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = (req.url || "").match(/^\/api\/([a-z]+)(?:\?|$)/);
        if (!m) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          const method = req.method || "GET";
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method,
            headers,
            body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
          });
          const { handleDev } = (await server.ssrLoadModule("/server/dev.ts")) as typeof import("./server/dev");
          const out = await handleDev(m[1], request);
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (e) {
          console.error("[dev-api]", e);
          res.statusCode = 500;
          res.end("dev api error");
        }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [devApi()],
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
