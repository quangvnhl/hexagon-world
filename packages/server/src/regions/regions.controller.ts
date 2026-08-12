import { BadRequestException, Body, Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { sanitizePlayerAppearance } from "@hexagon/shared";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";
import { TicketService } from "./ticket.service";

interface TicketBody { region?: string; guestId?: string; displayName?: string; appearance?: { colorIndex?: number; shape?: string; trailPattern?: string }; }

@Controller("v1")
export class RegionsController {
  constructor(private readonly sessions: SessionService, private readonly tickets: TicketService, private readonly db: SupabaseService) {}

  @Get("regions") regions() { return { regions: runtimeConfig().regions }; }

  @Post("game-tickets/guest") guest(@Body() body: TicketBody) {
    const region = this.assertRegion(body.region);
    const guestId = String(body.guestId ?? "").trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(guestId)) throw new BadRequestException("invalid_guest_id");
    return { ticket: this.tickets.issue({ playerId: null, guestId, isGuest: true, platform: "web", displayName: String(body.displayName || "Guest").slice(0, 32), region, appearance: { colorIndex: 0, shape: "cube", trailPattern: "solid" } }), region };
  }

  @Post("game-tickets")
  async authenticated(@Req() req: Request, @Body() body: TicketBody) {
    const player = await this.sessions.resolve(req);
    const region = this.assertRegion(body.region);
    const { data } = await this.db.from("player_profiles").select("selected_color,selected_shape,selected_trail_pattern").eq("player_id", player.id).maybeSingle();
    const appearance = sanitizePlayerAppearance({ colorIndex: Number(String(data?.selected_color ?? "color:0").split(":")[1] ?? 0), shape: String(data?.selected_shape ?? "shape:cube").replace("shape:", "") as never, trailPattern: String(data?.selected_trail_pattern ?? "trail:solid").replace("trail:", "") as never });
    return { ticket: this.tickets.issue({ playerId: player.id, guestId: null, isGuest: false, platform: player.platform, displayName: player.displayName, region, appearance }), region };
  }

  private assertRegion(value?: string): string {
    const region = String(value || runtimeConfig().regions[0]?.id || "local");
    if (!runtimeConfig().regions.some((r) => r.id === region)) throw new BadRequestException("unknown_region");
    return region;
  }
}
