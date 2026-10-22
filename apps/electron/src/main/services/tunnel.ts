import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { Resolver } from "node:dns/promises";
import path from "node:path";
import type { TunnelInfo } from "@shared/contracts";

const URL_PATTERN = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 30_000;
export const CLOUDFLARED_DOWNLOADS = "https://developers.cloudflare.com/tunnel/downloads/";
const DNS_WAIT_MS = 60_000;

/* An app opened from the Dock or Finder gets a bare PATH that leaves out Homebrew, so a cloudflared that
   was installed with `brew install` would be reported as missing. Add the usual places. */
function searchPath() {
  const extra = process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : process.platform === "linux" ? ["/usr/local/bin", "/usr/bin"] : [];
  const current = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [...current, ...extra.filter((p) => !current.includes(p))].join(path.delimiter);
}

/* A new trycloudflare.com name takes a while to appear in DNS. Opening the link before then fails, and
   the computer's own resolver then caches "not found" for minutes. So the link is only shown once
   Cloudflare's public resolver can see it; asking 1.1.1.1 keeps the local cache out of it. */
async function waitForDns(host: string, isCancelled: () => boolean): Promise<void> {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(["1.1.1.1", "1.0.0.1"]);
  const deadline = Date.now() + DNS_WAIT_MS;
  while (Date.now() < deadline && !isCancelled()) {
    try {
      if ((await resolver.resolve4(host)).length) return;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

interface Tunnel {
  info: TunnelInfo;
  proc: ChildProcess | null;
}

export class TunnelManager extends EventEmitter {
  private tunnels = new Map<number, Tunnel>();

  get(port: number): TunnelInfo | null {
    return this.tunnels.get(port)?.info ?? null;
  }

  ports(): number[] {
    return [...this.tunnels.keys()];
  }

  start(port: number): void {
    const existing = this.tunnels.get(port);
    if (existing && existing.info.status !== "error") return;

    const tunnel: Tunnel = { info: { status: "starting", url: null, error: null }, proc: null };
    this.tunnels.set(port, tunnel);
    this.emit("change");

    const fail = (message: string) => {
      tunnel.info = { status: "error", url: null, error: message };
      tunnel.proc?.kill();
      this.emit("change");
    };

    const proc = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
      windowsHide: true,
      env: { ...process.env, PATH: searchPath() }
    });
    tunnel.proc = proc;

    const timer = setTimeout(() => {
      if (tunnel.info.status === "starting") fail("Timed out waiting for Cloudflare to assign a URL.");
    }, START_TIMEOUT_MS);

    // cloudflared logs to stderr. The URL is printed before the edge connection is up, so the link only
    // counts as live once a connection is registered (opening it earlier fails to resolve).
    let url: string | null = null;
    let registered = false;
    let publishing = false;
    const onOutput = (chunk: Buffer) => {
      if (tunnel.info.status !== "starting" || publishing) return;
      const text = chunk.toString();
      url ??= URL_PATTERN.exec(text)?.[0] ?? null;
      registered ||= text.includes("Registered tunnel connection");
      if (url && registered) {
        publishing = true;
        clearTimeout(timer);
        const link = url;
        const gone = () => this.tunnels.get(port) !== tunnel || tunnel.info.status !== "starting";
        void waitForDns(new URL(link).host, gone).then(() => {
          if (gone()) return;
          tunnel.info = { status: "live", url: link, error: null };
          this.emit("change");
        });
      }
    };
    proc.stdout?.on("data", onOutput);
    proc.stderr?.on("data", onOutput);

    proc.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(
        error.code === "ENOENT"
          ? `cloudflared is not installed. Get it at ${CLOUDFLARED_DOWNLOADS}`
          : error.message
      );
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      if (this.tunnels.get(port) !== tunnel || tunnel.info.status === "error") return;
      if (tunnel.info.status === "starting") {
        fail("cloudflared exited before the tunnel was ready. Check your internet connection.");
        return;
      }
      this.tunnels.delete(port);
      this.emit("change");
    });
  }

  stop(port: number): void {
    const tunnel = this.tunnels.get(port);
    if (!tunnel) return;
    this.tunnels.delete(port);
    tunnel.proc?.kill();
    this.emit("change");
  }

  stopAll(): void {
    for (const tunnel of this.tunnels.values()) tunnel.proc?.kill();
    this.tunnels.clear();
  }
}
