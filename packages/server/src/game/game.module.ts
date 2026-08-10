import {
  Module,
  Injectable,
  type OnModuleInit,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { NetServer } from "../net/net-server";
import { DEFAULT_PORT, MAX_PLAYERS, BOT_COUNT, TICK_RATE } from "../config";

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

  async onModuleInit(): Promise<void> {
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    this.net = new NetServer({ port, tickRate: TICK_RATE });
    await this.net.start();
    // eslint-disable-next-line no-console
    console.log(
      `[Hexagon] Server AUTHORITATIVE đang chạy — cổng ${this.net.port}, ` +
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
  providers: [GatewayService],
})
export class GameModule {}
