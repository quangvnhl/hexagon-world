import {
  Module,
  Injectable,
  type OnModuleInit,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { NetServer } from "../net/net-server";
import { DEFAULT_PORT, MAX_PLAYERS, BOT_COUNT, TICK_RATE } from "../config";
import { runtimeConfig } from "../runtime-config";
import { TicketService } from "../regions/ticket.service";
import { MatchResultReporter } from "../matches/match-result-reporter.service";

/**
 * GatewayService — vòng đời NetServer trong NestJS.
 *
 * NetServer tự quản lý VÒNG ĐỜI PHÒNG (tạo khi có người vào, đóng khi hết người/hết ván),
 * nên ở đây chỉ cần khởi động/đóng nó. Không cần DI GameRoom (tránh phụ thuộc metadata).
 * Chỉ chạy ở production bootstrap — vitest không đụng module này.
 */
@Injectable()
export class GatewayService implements OnModuleInit, OnApplicationShutdown {
  private net: NetServer | null = null;

  constructor(private readonly adapter: HttpAdapterHost, private readonly tickets: TicketService, private readonly results: MatchResultReporter) {}

  async onModuleInit(): Promise<void> {
    const cfg = runtimeConfig();
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    this.net = new NetServer({
      port,
      tickRate: TICK_RATE,
      httpServer: this.adapter.httpAdapter.getHttpServer(),
      path: cfg.role === "all" ? undefined : "/game",
      requireTicket: cfg.role === "game",
      authenticateTicket: (token) => this.tickets.verify(token, cfg.region),
      region: cfg.region,
      serverVersion: process.env.npm_package_version ?? "0.1.0",
      onMatchResult: (result) => this.results.report(result),
    });
    await this.net.start();
    // eslint-disable-next-line no-console
    console.log(
      `[Hexagon] Server AUTHORITATIVE region=${cfg.region} chuẩn bị trên cổng ${port}, ` +
        `${TICK_RATE} Hz. Phòng tạo khi có người vào ` +
        `(tối đa ${MAX_PLAYERS} ghế người + ${BOT_COUNT} bot), ` +
        `đóng khi hết người hoặc hết ván.`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.net) {
      await this.net.close();
      this.net = null;
    }
  }
}

@Module({
  providers: [GatewayService, TicketService, MatchResultReporter],
})
export class GameModule {}
