import { Module } from "@nestjs/common";
import { AdminController } from "../admin/admin.controller";
import { AuthController } from "../auth/auth.controller";
import { EnergyController } from "../energy/energy.controller";
import { GoogleOAuthController } from "../auth/google-oauth.controller";
import { IdentityService } from "../auth/identity.service";
import { SessionService } from "../auth/session.service";
import { TelegramAuthController } from "../auth/telegram-auth.controller";
import { MatchesController } from "../matches/matches.controller";
import { TelegramPaymentsController } from "../payments/telegram-payments.controller";
import { PlayersController } from "../players/players.controller";
import { RegionsController } from "../regions/regions.controller";
import { TicketService } from "../regions/ticket.service";
import { ShopController } from "../shop/shop.controller";
import { ControlBootstrapService } from "./control-bootstrap.service";

@Module({
  controllers: [AdminController, AuthController, EnergyController, GoogleOAuthController, TelegramAuthController, MatchesController, TelegramPaymentsController, PlayersController, RegionsController, ShopController],
  providers: [IdentityService, SessionService, TicketService, ControlBootstrapService],
})
export class ControlModule {}
