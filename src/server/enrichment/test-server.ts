/**
 * Tiny local HTTP server for crawler tests (127.0.0.1, random port). Test-only helper: not imported
 * by application code.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type RouteSpec = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Wait before sending headers. */
  delayMs?: number;
};
export type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
export type Route = RouteSpec | RouteHandler;

export type TestServer = {
  port: number;
  /** http://127.0.0.1:<port> */
  origin: string;
  /** Absolute URL on this server; `host` replaces 127.0.0.1 (resolve it with a test resolver). */
  url(path: string, host?: string): string;
  /** "<Host header> <path>" for every request received, in order. */
  hits: string[];
  /** Request headers of every request, in order. */
  requests: http.IncomingHttpHeaders[];
  setRoute(path: string, route: Route): void;
  close(): Promise<void>;
};

export async function startTestServer(routes: Record<string, Route> = {}): Promise<TestServer> {
  const table = new Map<string, Route>(Object.entries(routes));
  const hits: string[] = [];
  const requests: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    hits.push(`${req.headers.host ?? ""} ${path}`);
    requests.push(req.headers);
    const hostKey = `${(req.headers.host ?? "").split(":")[0]}${path}`;
    const route = table.get(hostKey) ?? table.get(path) ?? table.get(path.split("?")[0] ?? path);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (typeof route === "function") return route(req, res);
    const send = () => {
      res.writeHead(route.status ?? 200, { "content-type": "text/html; charset=utf-8", ...route.headers });
      res.end(route.body ?? "");
    };
    if (route.delayMs) setTimeout(send, route.delayMs);
    else send();
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    url: (path, host = "127.0.0.1") => `http://${host}:${port}${path}`,
    hits,
    requests,
    setRoute: (path, route) => table.set(path, route),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Resolver mapping every host name to 127.0.0.1 (pair with allowPrivateNetwork: true). */
export const localResolver = async () => [{ address: "127.0.0.1", family: 4 as const }];

/** Cloudflare's email-protection encoding: key byte, then every UTF-8 byte XOR key, as hex. */
export function encodeCfEmail(email: string, key = 0x5a): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return hex(key) + Array.from(new TextEncoder().encode(email), (b) => hex(b ^ key)).join("");
}
