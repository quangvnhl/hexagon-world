"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlModule = void 0;
const common_1 = require("@nestjs/common");
const admin_controller_1 = require("../admin/admin.controller");
const auth_controller_1 = require("../auth/auth.controller");
const campaign_controller_1 = require("../campaign/campaign.controller");
const dev_auth_controller_1 = require("../auth/dev-auth.controller");
const energy_controller_1 = require("../energy/energy.controller");
const google_oauth_controller_1 = require("../auth/google-oauth.controller");
const identity_service_1 = require("../auth/identity.service");
const session_service_1 = require("../auth/session.service");
const telegram_auth_controller_1 = require("../auth/telegram-auth.controller");
const matches_controller_1 = require("../matches/matches.controller");
const telegram_payments_controller_1 = require("../payments/telegram-payments.controller");
const players_controller_1 = require("../players/players.controller");
const regions_controller_1 = require("../regions/regions.controller");
const ticket_service_1 = require("../regions/ticket.service");
const shop_controller_1 = require("../shop/shop.controller");
const control_bootstrap_service_1 = require("./control-bootstrap.service");
let ControlModule = class ControlModule {
};
exports.ControlModule = ControlModule;
exports.ControlModule = ControlModule = __decorate([
    (0, common_1.Module)({
        controllers: [admin_controller_1.AdminController, auth_controller_1.AuthController, campaign_controller_1.CampaignController, dev_auth_controller_1.DevAuthController, energy_controller_1.EnergyController, google_oauth_controller_1.GoogleOAuthController, telegram_auth_controller_1.TelegramAuthController, matches_controller_1.MatchesController, telegram_payments_controller_1.TelegramPaymentsController, players_controller_1.PlayersController, regions_controller_1.RegionsController, shop_controller_1.ShopController],
        providers: [identity_service_1.IdentityService, session_service_1.SessionService, ticket_service_1.TicketService, control_bootstrap_service_1.ControlBootstrapService],
    })
], ControlModule);
//# sourceMappingURL=control.module.js.map