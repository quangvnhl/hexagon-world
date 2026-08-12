import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MatchResultEnvelope } from "../net/net-server";
import { runtimeConfig } from "../runtime-config";

@Injectable()
export class MatchResultReporter implements OnModuleInit {
  private readonly logger = new Logger(MatchResultReporter.name);
  private readonly attempts = new Map<string, number>();
  private readonly timers = new Set<NodeJS.Timeout>();

  onModuleInit(): void {
    const cfg = runtimeConfig();
    if (!cfg.gameResultSecret) return;
    mkdirSync(this.root(), { recursive: true });
    for (const name of readdirSync(this.root()).filter((v) => v.endsWith(".json"))) {
      try { const result = JSON.parse(readFileSync(join(this.root(), name), "utf8")) as MatchResultEnvelope; void this.deliver(result); }
      catch { this.logger.warn(`Bỏ qua match spool hỏng: ${name}`); }
    }
  }

  async report(result: MatchResultEnvelope): Promise<void> {
    const cfg = runtimeConfig();
    if (!cfg.gameResultSecret) return;
    mkdirSync(this.root(), { recursive: true });
    const target = this.file(result.eventId);
    if (!existsSync(target)) {
      const temp = `${target}.tmp`;
      writeFileSync(temp, JSON.stringify(result), { encoding: "utf8", flag: "wx" });
      renameSync(temp, target);
    }
    await this.deliver(result);
  }

  private root(): string { return resolve(runtimeConfig().gameResultSpoolDir); }
  private file(eventId: string): string { return join(this.root(), `${eventId.replace(/[^a-f0-9-]/gi, "")}.json`); }

  private async deliver(result: MatchResultEnvelope): Promise<void> {
    const cfg = runtimeConfig();
    const body = JSON.stringify(result);
    const signature = createHmac("sha256", cfg.gameResultSecret).update(body).digest("hex");
    try {
      const response = await fetch(`${cfg.controlPlaneUrl}/internal/v1/match-results`, { method: "POST", headers: { "content-type": "application/json", "x-game-signature": signature }, body, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      rmSync(this.file(result.eventId), { force: true });
      this.attempts.delete(result.eventId);
    } catch (error) {
      const attempt = (this.attempts.get(result.eventId) ?? 0) + 1;
      this.attempts.set(result.eventId, attempt);
      const timer = setTimeout(() => { this.timers.delete(timer); void this.deliver(result); }, Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)));
      timer.unref();
      this.timers.add(timer);
      if (attempt === 1 || attempt % 10 === 0) this.logger.warn(`Match ${result.matchId} đang chờ gửi lại: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
