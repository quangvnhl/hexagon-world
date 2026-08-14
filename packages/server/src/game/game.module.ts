import {
  Module,
  Injectable,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { NetServer } from "../net/net-server";
import { DEFAULT_PORT, MAX_HUMAN_PLAYERS, ONLINE_BOT_CAPACITY_MIN, ONLINE_BOT_CAPACITY_MAX, TICK_RATE, SERVER_PROTOCOL_VERSION, WS_BACKPRESSURE_BYTES } from "../config";
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
export class GatewayService implements OnApplicationShutdown {
  private net: NetServer | null = null;

  constructor(private readonly adapter: HttpAdapterHost, private readonly tickets: TicketService, private readonly results: MatchResultReporter) {}

  /** Gắn WebSocket sau khi Nest HTTP server đã listen.
   *
   * `onModuleInit` chạy quá sớm: ở thời điểm đó ExpressAdapter có thể chưa trả về
   * HTTP server, làm NetServer hiểu nhầm là chế độ standalone và chiếm PORT lần
   * thứ nhất. Sau đó `app.listen()` chiếm cùng PORT và tiến trình chết EADDRINUSE.
   */
  async start(): Promise<void> {
    if (this.net) return;
    const cfg = runtimeConfig();
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    this.net = new NetServer({
      port,
      tickRate: TICK_RATE,
      httpServer: this.adapter.httpAdapter.getHttpServer(),
      // Dùng cùng endpoint ở cả node kết hợp và node game độc lập. Không để path
      // undefined ở role=all vì client/region ticket luôn công bố URL `/game`.
      path: "/game",
      requireTicket: cfg.role === "game",
      authenticateTicket: (token) => this.tickets.verify(token, cfg.region),
      region: cfg.region,
      serverVersion: process.env.npm_package_version ?? "0.1.0",
      protocolVersion: SERVER_PROTOCOL_VERSION,
      backpressureBytes: WS_BACKPRESSURE_BYTES,
      onMatchResult: (result) => this.results.report(result),
    });
    await this.net.start();
    // eslint-disable-next-line no-console
    console.log(
      `[Hexagon] Server AUTHORITATIVE region=${cfg.region} chuẩn bị trên cổng ${port}, ` +
        `${TICK_RATE} Hz. Phòng tạo khi có người vào ` +
        `(tối đa ${MAX_HUMAN_PLAYERS} ghế người + ${ONLINE_BOT_CAPACITY_MIN}..${ONLINE_BOT_CAPACITY_MAX} bot online/room), ` +
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
  exports: [GatewayService],
})
export class GameModule {}
