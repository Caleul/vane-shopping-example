import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { startVane } from "./vane.mjs";
import { shoppingApp, ApiError } from "./app.mjs";

export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const vane = await startVane(databaseUrl);
  const app = shoppingApp(vane);
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      let body = {},
        length = 0;
      if (["POST", "PUT"].includes(req.method)) {
        const chunks = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 128 * 1024)
            throw new ApiError(
              413,
              "BODY_TOO_LARGE",
              "Request body exceeds 128 KiB.",
            );
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new ApiError(
            400,
            "INVALID_JSON",
            "Body must contain valid JSON.",
          );
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new ApiError(
            400,
            "INVALID_INPUT",
            "Body must be a JSON object.",
          );
      }
      const response = await app({
        method: req.method,
        url,
        body,
        headers: req.headers,
      });
      res.statusCode = response.status;
      res.end(JSON.stringify(response.data));
    } catch (error) {
      res.statusCode = error.status ?? 500;
      res.end(
        JSON.stringify({
          code: error.code ?? "INTERNAL_ERROR",
          message: error.status
            ? error.message
            : "The request could not be completed.",
        }),
      );
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await vane.close();
    throw error;
  }
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await vane.close();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const service = await startServer();
  console.log(`Shopping API: ${service.url}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await service.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
