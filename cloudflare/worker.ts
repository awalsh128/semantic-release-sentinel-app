import { DurableObject } from "cloudflare:workers";

interface Env {
  SENTINEL: DurableObjectNamespace<Sentinel>;
  APP_ID: string;
  WEBHOOK_SECRET: string;
  PRIVATE_KEY: string;
}

const PORT = 3000;

export class Sentinel extends DurableObject<Env> {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Expose only the webhook path.
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/api/github/webhooks") {
      return new Response("Not found", { status: 404 });
    }
    return env.SENTINEL.getByName("sentinel").fetch(request);
  },
};
