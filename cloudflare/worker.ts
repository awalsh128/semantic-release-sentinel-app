import { request } from "@octokit/request";
import { DurableObject } from "cloudflare:workers";
import { ipInRanges, validSignature } from "./guard.js";

interface Env {
  SENTINEL: DurableObjectNamespace<Sentinel>;
  APP_ID: string;
  WEBHOOK_SECRET: string;
  PRIVATE_KEY: string;
}

const PORT = 3000;
const WEBHOOK_PATH = "/api/github/webhooks";
// GitHub caps webhook payloads at 25 MB.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
// Events worth waking the container for. The App is subscribed to more (see app.yml), but only
// pull_request is acted on; ping is forwarded so GitHub's "Redeliver" tests the whole path.
// Add an event here when the app starts handling it.
const FORWARDED_EVENTS = new Set(["ping", "pull_request"]);
const HOOK_RANGES_TTL_MS = 60 * 60 * 1000;

export class Sentinel extends DurableObject<Env> {
  /**
   * GitHub's webhook source ranges, refreshed hourly. Kept in this object's storage so one fetch
   * serves every request (api.github.com/meta is rate limited for unauthenticated callers). If a
   * refresh fails, the last known list is used.
   */
  async hookRanges(): Promise<string[]> {
    const cached = await this.ctx.storage.get<{ at: number; ranges: string[] }>("hooks");
    if (cached && Date.now() - cached.at < HOOK_RANGES_TTL_MS) return cached.ranges;
    try {
      const { data } = await request("GET /meta"); // throws on a non-2xx response
      const ranges = data.hooks ?? [];
      if (ranges.length === 0) throw new Error("GET /meta returned no hooks ranges");
      await this.ctx.storage.put("hooks", { at: Date.now(), ranges });
      return ranges;
    } catch (error) {
      if (cached) return cached.ranges;
      throw error;
    }
  }

  private async ready(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        env: {
          HOST: "0.0.0.0", // Probot listens on localhost by default
          PORT: String(PORT),
          APP_ID: this.env.APP_ID,
          WEBHOOK_SECRET: this.env.WEBHOOK_SECRET,
          PRIVATE_KEY: this.env.PRIVATE_KEY,
          LOG_LEVEL: "info",
        },
      });
    }
    // Probot answers /ping once it is up.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const res = await container.getTcpPort(PORT).fetch("http://container/ping");
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("container did not become ready");
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready();
    return this.ctx.container!.getTcpPort(PORT).fetch(request);
  }
}

const reject = (status: number, message: string) => new Response(message, { status });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Cheapest checks first, so junk costs almost nothing and never reaches the container.
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== WEBHOOK_PATH) return reject(404, "Not found");

    const event = request.headers.get("X-GitHub-Event");
    if (!event || !request.headers.get("X-GitHub-Delivery")) return reject(400, "Not a GitHub webhook");

    const length = Number(request.headers.get("Content-Length"));
    if (!Number.isInteger(length) || length <= 0) return reject(411, "Content-Length required");
    if (length > MAX_BODY_BYTES) return reject(413, "Payload too large");

    // Authenticate the body before anything else costs money. It is read once and forwarded as the
    // same bytes, so the signature the container checks is the one checked here.
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return reject(413, "Payload too large");
    if (!(await validSignature(env.WEBHOOK_SECRET, body, request.headers.get("X-Hub-Signature-256")))) {
      return reject(401, "Bad signature");
    }

    // Defense in depth for a leaked webhook secret: only GitHub's webhook IPs. CF-Connecting-IP is
    // set by Cloudflare's edge, so a caller can't spoof it.
    const sentinel = env.SENTINEL.getByName("sentinel");
    const ip = request.headers.get("CF-Connecting-IP");
    let ranges: string[];
    try {
      ranges = await sentinel.hookRanges();
    } catch {
      return reject(503, "Can't load GitHub's webhook IP ranges; retry"); // GitHub can redeliver
    }
    if (!ip || !ipInRanges(ip, ranges)) return reject(403, "Not a GitHub webhook source");

    if (!FORWARDED_EVENTS.has(event)) return reject(202, "Event ignored");

    return sentinel.fetch(new Request(request, { body }));
  },
};
