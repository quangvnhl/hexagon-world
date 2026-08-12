import { Module } from "@nestjs/common";
import { GameModule } from "./game/game.module";
import { ControlModule } from "./control/control.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";

const role = process.env.SERVER_ROLE ?? "all";

/** Module gốc: gom GameModule (phòng chơi + gateway mạng). */
@Module({
  imports: [DatabaseModule, ...(role === "game" ? [] : [ControlModule]), ...(role === "control" ? [] : [GameModule])],
  controllers: [HealthController],
})
export class AppModule {}
