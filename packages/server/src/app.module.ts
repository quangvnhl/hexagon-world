import { Module } from "@nestjs/common";
import { GameModule } from "./game/game.module";

/** Module gốc: gom GameModule (phòng chơi + gateway mạng). */
@Module({
  imports: [GameModule],
})
export class AppModule {}
