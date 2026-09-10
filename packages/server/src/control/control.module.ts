import { Module } from "@nestjs/common";
import { AdminController } from "../admin/admin.controller";
import { OpsAuditInterceptor } from "../admin/ops-audit.interceptor";
import { OpsKeysService } from "../admin/ops-keys.service";
import { AnalyticsController } from "../analytics/analytics.controller";
import { ServerAnalyticsService } from "../analytics/server-analytics.service";
import { AuthController } from "../auth/auth.controller";
import { CampaignController } from "../campaign/campaign.controller";
import { ReplayService } from "../campaign/replay.service";
import { DevAuthController } from "../auth/dev-auth.controller";
import { DailyController } from "../daily/daily.controller";
import { EnergyController } from "../energy/energy.controller";
import { GoogleOAuthController } from "../auth/google-oauth.controller";
import { IdentityService } from "../auth/identity.service";
import { SessionService } from "../auth/session.service";
import { TelegramAuthController } from "../auth/telegram-auth.controller";
import { MatchesController } from "../matches/matches.controller";
import { TelegramPaymentsController } from "../payments/telegram-payments.controller";
import { PlayersController } from "../players/players.controller";
import { RegionsController } from "../regions/regions.controller";
import { RemoteConfigController } from "../config-api/remote-config.controller";
import { TicketService } from "../regions/ticket.service";
import { ShopController } from "../shop/shop.controller";
import { ControlBootstrapService } from "./control-bootstrap.service";

@Module({
  controllers: [AdminController, AnalyticsController, AuthController, CampaignController, DailyController, DevAuthController, EnergyController, GoogleOAuthController, TelegramAuthController, MatchesController, TelegramPaymentsController, PlayersController, RegionsController, RemoteConfigController, ShopController],
  providers: [ReplayService, IdentityService, SessionService, TicketService, ControlBootstrapService, ServerAnalyticsService, OpsKeysService, OpsAuditInterceptor],
})
export class ControlModule {}
