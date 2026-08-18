"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetServer = void 0;
const ws_1 = require("ws");
const node_perf_hooks_1 = require("node:perf_hooks");
const node_crypto_1 = require("node:crypto");
const shared_1 = require("@hexagon/shared");
const game_room_1 = require("../game/game-room");
const territory_aoi_1 = require("./territory-aoi");
const config_1 = require("../config");
const network_transport_1 = require("./network-transport");
const rate_limit_1 = require("./rate-limit");
const telemetry_1 = require("./telemetry");
const TERRITORY_EVERY = 6;
const WORLD_UI_EVERY = 5;
const ENDED_GRACE_MS = 8000;
class NetServer {
    constructor(opts = {}) {
        this.autoLoop = false;
        this.nextRoomId = 1;
        this.inputRatePerSec = config_1.WS_INPUT_RATE_PER_SEC;
        this.inputBurst = config_1.WS_INPUT_BURST;
        this.textRateMax = config_1.WS_TEXT_RATE_MAX;
        this.textRateWindowMs = config_1.WS_TEXT_RATE_WINDOW_MS;
        this.textFloodStrikes = config_1.WS_TEXT_FLOOD_STRIKES;
        this.maxConnPerIp = config_1.WS_MAX_CONN_PER_IP;
        this.connsByIp = new Map();
        this.conns = new Map();
        this.rooms = new Set();
        this.resumeSessions = new Map();
        this.socketAlive = new WeakMap();
        this.active = null;
        this.tickRate = opts.tickRate ?? config_1.TICK_RATE;
        this.dt = this.tickRate === config_1.TICK_RATE ? config_1.DT : 1 / this.tickRate;
        this.tickMs = 1000 / this.tickRate;
        this.attachedToHttp = Boolean(opts.httpServer);
        this.requireTicket = opts.requireTicket ?? false;
        this.authenticateTicket = opts.authenticateTicket;
        this.region = opts.region ?? "local";
        this.serverVersion = opts.serverVersion ?? "dev";
        this.onMatchResult = opts.onMatchResult;
        this.entityAoiRadius = opts.entityAoiRadius ?? config_1.ENTITY_AOI_RADIUS;
        this.protocolVersion = opts.protocolVersion ?? shared_1.GAME_PROTOCOL_VERSION;
        this.transport = new network_transport_1.NetworkTransport(opts.backpressureBytes ?? config_1.WS_BACKPRESSURE_BYTES, network_transport_1.gameNetworkMetrics);
        this.maxHumans = opts.maxHumans ?? config_1.MAX_HUMAN_PLAYERS;
        this.onlineBotsOverride = opts.onlineBots === undefined
            ? null
            : Math.min(16, Math.max(0, Math.round(opts.onlineBots)));
        this.botJoinIntervalMs = opts.botJoinIntervalMs ?? config_1.ONLINE_BOT_JOIN_INTERVAL_MS;
        this.kingDurationSeconds = opts.kingDurationSeconds ?? config_1.KING_ROOM_DURATION_SECONDS;
        this.reconnectGraceMs = Math.max(100, Math.round(opts.reconnectGraceMs ?? config_1.LOBBY_RECONNECT_GRACE_MS));
        this.wss = opts.httpServer
            ? new ws_1.WebSocketServer({ server: opts.httpServer, ...(opts.path ? { path: opts.path } : {}) })
            : new ws_1.WebSocketServer({ port: opts.port ?? 0 });
        this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
        this.heartbeatTimer = setInterval(() => this.heartbeatSockets(), config_1.WS_HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref();
    }
    get port() {
        const addr = this.wss.address();
        if (addr && typeof addr === "object")
            return addr.port;
        return -1;
    }
    async listen() {
        this.autoLoop = false;
        await this.whenListening();
    }
    async start() {
        this.autoLoop = true;
        if (this.attachedToHttp)
            return;
        await this.whenListening();
    }
    get activeRoom() {
        return this.active && !this.active.ended ? this.active.room : ([...this.rooms].find((room) => !room.ended)?.room ?? null);
    }
    get roomCount() {
        return this.rooms.size;
    }
    get networkMetrics() { return this.transport.snapshot(); }
    get roomStats() {
        return [...this.rooms].map((room) => ({
            id: room.id,
            humanCount: room.room.occupied(),
            activeBotCount: room.room.activeBotCount,
            capacity: room.room.capacity,
            capacityFull: room.room.occupied() >= room.room.capacity,
            kingAdmissionLocked: room.room.kingAdmissionLocked,
            ended: room.ended,
        }));
    }
    tickOnce() {
        for (const r of this.rooms) {
            if (!r.started || r.ended)
                continue;
            this.stepRoom(r);
            this.broadcast(r);
            this.broadcastWorldUiIfDue(r);
            this.flushTerritoryIfDue(r);
        }
    }
    whenListening() {
        if (this.wss.address())
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            this.wss.once("listening", () => resolve());
            this.wss.once("error", reject);
        });
    }
    findJoinableRoom() {
        for (const room of this.rooms) {
            if (!room.ended && !room.room.kingAdmissionLocked && room.room.occupied() < room.room.capacity)
                return room;
        }
        return null;
    }
    ensureActiveRoom() {
        const joinable = this.findJoinableRoom();
        if (joinable) {
            this.active = joinable;
            return joinable;
        }
        {
            const roomId = this.nextRoomId++;
            const botCapacity = this.onlineBotsOverride ?? (0, config_1.onlineBotCapacityForRoom)(roomId);
            const r = {
                id: roomId,
                room: new game_room_1.GameRoom(this.maxHumans, botCapacity, this.kingDurationSeconds, roomId),
                conns: new Set(),
                started: false,
                ended: false,
                endedAt: 0,
                timer: null,
                lastTime: 0,
                accumulator: 0,
                running: false,
                scheduledAt: 0,
                lastTerrRev: -1,
                lastTotemRev: -1,
                prevAlive: [],
                prevWon: false,
                prevKingId: -1,
                matchId: null,
                startedAt: null,
                reported: false,
                participants: new Map(),
                matchStats: new Map(),
                botActivationElapsedMs: 0,
                readySeats: new Set(),
            };
            r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
            this.rooms.add(r);
            this.active = r;
            telemetry_1.serverTelemetry.setRoomsActive(this.rooms.size);
        }
        return this.active;
    }
    canStart(r) {
        const present = r.room.occupied();
        return !r.started && !r.ended && present >= config_1.MIN_PLAYERS &&
            r.conns.size === present && r.readySeats.size === present;
    }
    startGame(r) {
        if (!this.canStart(r))
            return;
        r.room.startMatch();
        r.started = true;
        r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
        r.prevWon = false;
        r.prevKingId = -1;
        r.matchId = (0, node_crypto_1.randomUUID)();
        r.startedAt = new Date().toISOString();
        r.reported = false;
        r.botActivationElapsedMs = 0;
        r.participants.clear();
        r.matchStats.clear();
        r.readySeats.clear();
        for (const ws of r.conns) {
            const conn = this.conns.get(ws);
            if (!conn || conn.entityId === null)
                continue;
            const identity = conn.identity ?? { playerId: null, guestId: `legacy-${r.id}-${conn.entityId}`, isGuest: true, platform: "web", displayName: r.room.gameState.nameOf(conn.entityId), appearance: { colorIndex: 0, shape: "cube", trailPattern: "solid" } };
            r.participants.set(conn.entityId, identity);
            r.matchStats.set(conn.entityId, { kills: 0, deaths: 0, deathCause: "" });
        }
        this.broadcastLobby(r);
        if (this.autoLoop)
            this.startLoop(r);
    }
    handleLastPlayer(r) {
        this.revertToWaiting(r);
    }
    revertToWaiting(r) {
        if (!r.started || r.ended)
            return;
        r.started = false;
        r.running = false;
        if (r.timer) {
            clearTimeout(r.timer);
            r.timer = null;
        }
        r.room.parkAll();
        r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
        r.prevWon = false;
        r.prevKingId = -1;
        this.broadcastLobby(r);
    }
    broadcastLobby(r) {
        for (const ws of r.conns) {
            const conn = this.conns.get(ws);
            if (!conn || conn.entityId === null)
                continue;
            this.send(ws, {
                t: "lobby",
                present: r.room.occupied(),
                needed: config_1.MIN_PLAYERS,
                started: r.started,
                readyCount: r.readySeats.size,
                selfReady: r.readySeats.has(conn.entityId),
            });
        }
    }
    broadcastRoster(r) {
        this.broadcastControl(r, { t: "roster", players: r.room.roster() });
        this.broadcastWorldUi(r);
    }
    broadcastWorldUiIfDue(r) {
        if (r.room.tick % WORLD_UI_EVERY === 0)
            this.broadcastWorldUi(r);
    }
    broadcastWorldUi(r) {
        this.broadcastControl(r, { t: "world_ui", entities: r.room.worldUiEntities() });
        for (const ws of r.conns) {
            const conn = this.conns.get(ws);
            if (!conn || conn.entityId === null)
                continue;
            const radarActive = r.room.gameState.radarActiveFor(conn.entityId);
            this.send(ws, {
                t: "minimap_ui",
                radarActive,
                entities: r.room.minimapUiEntitiesFor(conn.entityId),
            });
        }
    }
    sendTotems(ws, r) {
        this.send(ws, {
            t: "totems",
            revision: r.room.gameState.totemRevision,
            items: [...r.room.gameState.totemStates()],
        });
    }
    broadcastTotemsIfChanged(r) {
        const revision = r.room.gameState.totemRevision;
        if (revision === r.lastTotemRev)
            return;
        r.lastTotemRev = revision;
        for (const ws of r.conns)
            this.sendTotems(ws, r);
    }
    markEnded(r) {
        if (r.ended)
            return;
        r.ended = true;
        r.endedAt = Date.now();
        if (this.active === r)
            this.active = null;
        this.reportMatch(r);
    }
    reportMatch(r) {
        if (r.reported || !r.matchId || !r.startedAt || !this.onMatchResult)
            return;
        r.reported = true;
        const scores = [...r.participants.keys()].map((id) => ({ id, score: r.room.gameState.players[id]?.owned.size ?? 0 })).sort((a, b) => b.score - a.score);
        const placement = new Map(scores.map((entry, index) => [entry.id, index + 1]));
        const winner = r.room.gameState.winnerId;
        const winnerIdentity = r.participants.get(winner);
        const result = {
            eventId: (0, node_crypto_1.randomUUID)(), matchId: r.matchId, roomId: String(r.id), region: this.region, mode: "online", startedAt: r.startedAt, endedAt: new Date().toISOString(), winnerPlayerId: winnerIdentity?.playerId ?? "", serverVersion: this.serverVersion,
            players: [...r.participants.entries()].map(([seatId, identity]) => {
                const stats = r.matchStats.get(seatId) ?? { kills: 0, deaths: 0, deathCause: "" };
                const finalScore = r.room.gameState.players[seatId]?.owned.size ?? 0;
                return { participantKey: identity.playerId ?? identity.guestId ?? `seat-${seatId}`, playerId: identity.playerId ?? "", platform: identity.platform, isGuest: identity.isGuest, seatId, kills: stats.kills, deaths: stats.deaths, territoryCaptured: finalScore, deathCause: stats.deathCause, finalScore, placement: placement.get(seatId) ?? scores.length };
            }),
        };
        void Promise.resolve(this.onMatchResult(result)).catch(() => { r.reported = false; });
    }
    closeRoom(r) {
        r.running = false;
        if (r.timer) {
            clearTimeout(r.timer);
            r.timer = null;
        }
        this.rooms.delete(r);
        telemetry_1.serverTelemetry.setRoomsActive(this.rooms.size);
        if (this.active === r)
            this.active = null;
        for (const [token, session] of this.resumeSessions) {
            if (session.room !== r)
                continue;
            if (session.timer)
                clearTimeout(session.timer);
            this.resumeSessions.delete(token);
        }
        for (const ws of r.conns) {
            const c = this.conns.get(ws);
            if (c)
                c.room = null;
        }
        r.conns.clear();
    }
    startLoop(r) {
        if (r.running)
            return;
        r.running = true;
        r.lastTime = Date.now();
        r.accumulator = 0;
        this.scheduleNext(r);
    }
    scheduleNext(r) {
        if (!r.running)
            return;
        r.scheduledAt = node_perf_hooks_1.performance.now();
        r.timer = setTimeout(() => this.loop(r), this.tickMs);
    }
    loop(r) {
        if (!r.running)
            return;
        const lag = node_perf_hooks_1.performance.now() - (r.scheduledAt + this.tickMs);
        if (lag > 0)
            telemetry_1.serverTelemetry.recordEventLoopLag(lag);
        if (r.ended) {
            if (Date.now() - r.endedAt > ENDED_GRACE_MS)
                this.closeRoom(r);
            else
                this.scheduleNext(r);
            return;
        }
        const now = Date.now();
        let elapsed = (now - r.lastTime) / 1000;
        r.lastTime = now;
        let clamped = false;
        if (elapsed > this.dt * 5) {
            elapsed = this.dt * 5;
            clamped = true;
        }
        r.accumulator += elapsed;
        let steps = 0;
        while (r.accumulator >= this.dt) {
            this.stepRoom(r);
            r.accumulator -= this.dt;
            steps++;
        }
        if (steps > 0) {
            telemetry_1.serverTelemetry.recordTick(steps, clamped);
            this.broadcast(r);
            this.broadcastWorldUiIfDue(r);
            this.flushTerritoryIfDue(r);
        }
        if (r.ended && Date.now() - r.endedAt > ENDED_GRACE_MS) {
            this.closeRoom(r);
            return;
        }
        this.scheduleNext(r);
    }
    stepRoom(r) {
        const start = node_perf_hooks_1.performance.now();
        r.room.stepTick(this.dt);
        this.reconcileBots(r, this.dt * 1000);
        this.emitEvents(r);
        telemetry_1.serverTelemetry.recordTickStep(node_perf_hooks_1.performance.now() - start);
    }
    reconcileBots(r, elapsedMs) {
        if (r.room.kingCountdownActive || r.ended)
            return;
        const target = r.room.botCapacity;
        if (r.room.activeBotCount >= target) {
            r.botActivationElapsedMs = 0;
            return;
        }
        r.botActivationElapsedMs += elapsedMs;
        if (r.botActivationElapsedMs < this.botJoinIntervalMs)
            return;
        r.botActivationElapsedMs -= this.botJoinIntervalMs;
        r.room.activateNextBot();
    }
    clientIp(req) {
        const xff = req?.headers["x-forwarded-for"];
        if (typeof xff === "string" && xff.length > 0)
            return xff.split(",")[0].trim();
        if (Array.isArray(xff) && xff.length > 0)
            return String(xff[0]).split(",")[0].trim();
        return req?.socket?.remoteAddress ?? "unknown";
    }
    releaseIp(ip) {
        if (!ip)
            return;
        const n = this.connsByIp.get(ip);
        if (n === undefined)
            return;
        if (n <= 1)
            this.connsByIp.delete(ip);
        else
            this.connsByIp.set(ip, n - 1);
    }
    onConnection(ws, req) {
        const ip = this.clientIp(req);
        const current = this.connsByIp.get(ip) ?? 0;
        if (current >= this.maxConnPerIp) {
            telemetry_1.serverTelemetry.incIpRejected();
            try {
                ws.close(4008, "too many connections");
            }
            catch { }
            return;
        }
        this.connsByIp.set(ip, current + 1);
        this.socketAlive.set(ws, true);
        this.conns.set(ws, {
            entityId: null,
            room: null,
            identity: null,
            territoryRevision: 0,
            territoryCells: new Map(),
            territoryInterest: null,
            interestTargetId: null,
            reconnectToken: null,
            intentionalClose: false,
            ip,
            inputBucket: new rate_limit_1.TokenBucket(this.inputBurst, this.inputRatePerSec),
            textWindow: new rate_limit_1.SlidingWindowCounter(this.textRateMax, this.textRateWindowMs),
            textStrikes: 0,
        });
        ws.on("message", (data, isBinary) => {
            if (isBinary)
                this.onBinary(ws, data);
            else
                this.onText(ws, data.toString());
        });
        ws.on("close", () => this.onClose(ws));
        ws.on("error", () => this.onClose(ws));
        ws.on("pong", () => this.socketAlive.set(ws, true));
    }
    heartbeatSockets() {
        for (const ws of this.conns.keys()) {
            if (!this.socketAlive.get(ws)) {
                ws.terminate();
                continue;
            }
            this.socketAlive.set(ws, false);
            try {
                ws.ping();
            }
            catch {
                ws.terminate();
            }
        }
    }
    onBinary(ws, data) {
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        if (!conn.inputBucket.tryConsume()) {
            telemetry_1.serverTelemetry.incInputDropped();
            return;
        }
        if (conn.entityId === null || !conn.room || conn.room.ended)
            return;
        const input = (0, shared_1.decodeInput)(data);
        if (!input)
            return;
        conn.room.room.applyInput(conn.entityId, input.seq, input.heading);
    }
    issueResumeSession(ws, conn, r, entityId) {
        const token = (0, node_crypto_1.randomUUID)();
        conn.reconnectToken = token;
        this.resumeSessions.set(token, {
            token,
            room: r,
            entityId,
            identity: conn.identity,
            socket: ws,
            timer: null,
            expiresAt: null,
        });
        return token;
    }
    sendJoinState(ws, conn, r, resumed) {
        const id = conn.entityId;
        if (id === null)
            return;
        const reconnectToken = this.issueResumeSession(ws, conn, r, id);
        this.send(ws, {
            t: "welcome",
            playerId: id,
            arenaRadius: shared_1.CONFIG.ARENA_RADIUS,
            hexSize: shared_1.CONFIG.HEX_SIZE,
            tickRate: this.tickRate,
            seed: r.id,
            maxPlayers: this.maxHumans,
            botCount: r.room.botCapacity,
            config: (0, shared_1.encodeMatchConfig)(r.room.gameState.config),
            reconnectToken,
            resumed,
        });
        this.sendTerritory(ws, r);
        this.sendMinimapTerritory(ws, r);
        this.sendTotems(ws, r);
        this.broadcastRoster(r);
        this.broadcastLobby(r);
    }
    resumeConnection(ws, conn, token) {
        const session = this.resumeSessions.get(token);
        if (!session || session.room.ended ||
            (!session.socket && (session.expiresAt === null || session.expiresAt <= Date.now())))
            return false;
        if (session.socket && session.socket !== ws) {
            const staleSocket = session.socket;
            const staleConn = this.conns.get(staleSocket);
            session.room.conns.delete(staleSocket);
            if (staleConn) {
                staleConn.room = null;
                staleConn.entityId = null;
                staleConn.reconnectToken = null;
                staleConn.intentionalClose = true;
            }
            this.conns.delete(staleSocket);
            this.releaseIp(staleConn?.ip ?? null);
            this.transport.remove(staleSocket);
            try {
                staleSocket.terminate();
            }
            catch { }
        }
        if (session.timer)
            clearTimeout(session.timer);
        this.resumeSessions.delete(token);
        conn.entityId = session.entityId;
        conn.room = session.room;
        conn.identity = session.identity;
        conn.interestTargetId = null;
        session.room.conns.add(ws);
        this.sendJoinState(ws, conn, session.room, true);
        if (this.canStart(session.room))
            this.startGame(session.room);
        return true;
    }
    afterSeatRemoved(r) {
        if (r.room.occupied() === 0) {
            this.closeRoom(r);
        }
        else if (!r.ended && r.started && r.room.occupied() < config_1.MIN_PLAYERS) {
            this.handleLastPlayer(r);
        }
        else {
            this.broadcastRoster(r);
            this.broadcastLobby(r);
        }
    }
    removeConnectionSeat(ws, conn) {
        const r = conn.room;
        const entityId = conn.entityId;
        if (!r || entityId === null)
            return;
        if (conn.reconnectToken) {
            const session = this.resumeSessions.get(conn.reconnectToken);
            if (session?.timer)
                clearTimeout(session.timer);
            this.resumeSessions.delete(conn.reconnectToken);
        }
        r.readySeats.delete(entityId);
        r.room.leave(entityId);
        r.conns.delete(ws);
        conn.room = null;
        conn.entityId = null;
        conn.reconnectToken = null;
        this.afterSeatRemoved(r);
    }
    expireResumeSession(token) {
        const session = this.resumeSessions.get(token);
        if (!session || session.socket)
            return;
        this.resumeSessions.delete(token);
        const r = session.room;
        r.readySeats.delete(session.entityId);
        r.room.leave(session.entityId);
        this.afterSeatRemoved(r);
    }
    onText(ws, text) {
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        if (!conn.textWindow.record()) {
            conn.textStrikes++;
            telemetry_1.serverTelemetry.incTextFlood();
            if (conn.textStrikes >= this.textFloodStrikes) {
                telemetry_1.serverTelemetry.incTextDisconnect();
                try {
                    ws.close(4009, "text rate limit");
                }
                catch { }
            }
            return;
        }
        const msg = (0, shared_1.decodeControl)(text);
        if (!msg)
            return;
        if (msg.t === "join") {
            if (conn.entityId !== null)
                return;
            const requestedVersion = Number(msg.protocolVersion);
            if (!Number.isInteger(requestedVersion) || requestedVersion !== this.protocolVersion) {
                ws.close(4002, `protocol mismatch client=${Number.isInteger(requestedVersion) ? requestedVersion : "missing"} server=${this.protocolVersion}`);
                return;
            }
            let identity = null;
            if (msg.ticket && this.authenticateTicket) {
                try {
                    identity = this.authenticateTicket(msg.ticket);
                }
                catch {
                    ws.close(4003, "ticket khong hop le");
                    return;
                }
            }
            else if (this.requireTicket) {
                ws.close(4003, "can regional ticket");
                return;
            }
            if (msg.reconnectToken) {
                if (!this.resumeConnection(ws, conn, msg.reconnectToken)) {
                    ws.close(4003, "reconnect token khong hop le hoac da het han");
                }
                return;
            }
            conn.identity = identity;
            const r = this.ensureActiveRoom();
            const id = r.room.join(identity?.displayName ?? msg.name, {
                colorIndex: identity?.appearance.colorIndex ?? msg.colorIndex,
                trailPattern: identity?.appearance.trailPattern ?? msg.trailPattern,
                shape: identity?.appearance.shape ?? msg.shape,
            });
            if (id === null) {
                ws.close(4001, "phong day");
                return;
            }
            conn.entityId = id;
            conn.room = r;
            conn.interestTargetId = null;
            r.conns.add(ws);
            r.readySeats.delete(id);
            if (r.started) {
                const joinedIdentity = identity ?? { playerId: null, guestId: `legacy-${r.id}-${id}`, isGuest: true, platform: "web", displayName: r.room.gameState.nameOf(id), appearance: { colorIndex: 0, shape: "cube", trailPattern: "solid" } };
                r.participants.set(id, joinedIdentity);
                r.matchStats.set(id, { kills: 0, deaths: 0, deathCause: "" });
            }
            this.sendJoinState(ws, conn, r, false);
        }
        else if (msg.t === "interest") {
            if (msg.targetId === null)
                conn.interestTargetId = null;
            else if (Number.isInteger(msg.targetId) && msg.targetId >= 0)
                conn.interestTargetId = msg.targetId;
        }
        else if (msg.t === "ping") {
            this.send(ws, { t: "pong", time: msg.time });
        }
        else if (msg.t === "territory_resync") {
            if (conn.room)
                this.sendTerritory(ws, conn.room);
        }
        else if (msg.t === "territory_interest") {
            if (conn.room && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
                conn.territoryInterest = { x: msg.x, y: msg.y };
                this.sendTerritory(ws, conn.room);
            }
        }
        else if (msg.t === "lobby_ready") {
            if (conn.room && conn.entityId !== null && !conn.room.started && !conn.room.ended) {
                if (msg.ready)
                    conn.room.readySeats.add(conn.entityId);
                else
                    conn.room.readySeats.delete(conn.entityId);
                this.broadcastLobby(conn.room);
                if (this.canStart(conn.room))
                    this.startGame(conn.room);
            }
        }
        else if (msg.t === "lobby_cancel") {
            conn.intentionalClose = true;
            this.removeConnectionSeat(ws, conn);
            ws.close(1000, "roi phong");
        }
        else if (msg.t === "revive") {
            if (conn.room && conn.entityId !== null) {
                const entity = conn.room.room.gameState.players[conn.entityId];
                if (!entity || entity.phase !== "dead") {
                    this.send(ws, { t: "revive_result", ok: false, reason: "not_dead" });
                }
                else if (conn.room.room.kingCountdownActive) {
                    this.send(ws, { t: "revive_result", ok: false, reason: "king_locked" });
                }
                else if (conn.room.room.reviveSeat(conn.entityId)) {
                    conn.interestTargetId = null;
                    this.send(ws, { t: "revive_result", ok: true });
                }
                else {
                    this.send(ws, { t: "revive_result", ok: false, reason: "no_spawn" });
                }
            }
        }
    }
    onClose(ws) {
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        this.conns.delete(ws);
        this.releaseIp(conn.ip);
        this.transport.remove(ws);
        const r = conn.room;
        if (r && conn.entityId !== null) {
            r.conns.delete(ws);
            if (conn.intentionalClose || !conn.reconnectToken || r.ended) {
                this.removeConnectionSeat(ws, conn);
            }
            else {
                const session = this.resumeSessions.get(conn.reconnectToken);
                if (!session) {
                    this.removeConnectionSeat(ws, conn);
                }
                else {
                    session.socket = null;
                    session.expiresAt = Date.now() + this.reconnectGraceMs;
                    session.timer = setTimeout(() => this.expireResumeSession(session.token), this.reconnectGraceMs);
                    this.broadcastLobby(r);
                }
            }
        }
    }
    send(ws, msg) {
        this.transport.send(ws, (0, shared_1.encodeControl)(msg), "control");
    }
    broadcast(r) {
        for (const ws of r.conns) {
            const conn = this.conns.get(ws);
            if (!conn || conn.entityId === null)
                continue;
            this.transport.send(ws, (0, shared_1.encodeSnapshot)(r.room.buildSnapshotFor(conn.entityId, this.entityAoiRadius, conn.interestTargetId)), "snapshot", { binary: true, droppable: true });
        }
    }
    flushTerritoryIfDue(r) {
        const rev = r.room.gameState.territoryRevision;
        if (r.room.tick % TERRITORY_EVERY === 0 || rev !== r.lastTerrRev) {
            r.lastTerrRev = rev;
            this.broadcastTerritory(r);
        }
        if (r.room.tick % WORLD_UI_EVERY === 0)
            this.broadcastMinimapTerritory(r);
        this.broadcastTotemsIfChanged(r);
    }
    broadcastTerritory(r) {
        for (const ws of r.conns) {
            if (ws.readyState === ws_1.WebSocket.OPEN)
                this.sendTerritoryDelta(ws, r);
        }
    }
    sendTerritory(ws, r) {
        if (ws.readyState !== ws_1.WebSocket.OPEN)
            return;
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        const cells = this.territoryCellsForConnection(r, conn);
        this.transport.send(ws, (0, shared_1.encodeTerritory)(r.room.tick, cells), "territory_keyframe", { binary: true });
        conn.territoryRevision = 0;
        conn.territoryCells = new Map(cells.map((cell) => [this.territoryKey(cell.q, cell.r), cell]));
    }
    sendTerritoryDelta(ws, r) {
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        const cells = this.territoryCellsForConnection(r, conn);
        const current = new Map(cells.map((cell) => [this.territoryKey(cell.q, cell.r), cell]));
        const operations = [];
        for (const [key, previous] of conn.territoryCells) {
            if (!current.has(key))
                operations.push({ operation: "remove", q: previous.q, r: previous.r });
        }
        for (const [key, cell] of current) {
            const previous = conn.territoryCells.get(key);
            if (!previous || previous.owner !== cell.owner || previous.kind !== cell.kind) {
                operations.push({ operation: "upsert", cell });
            }
        }
        if (operations.length === 0)
            return;
        if (15 + operations.length * 7 >= 7 + cells.length * 6) {
            this.sendTerritory(ws, r);
            return;
        }
        const nextRevision = (conn.territoryRevision + 1) >>> 0;
        const sent = this.transport.send(ws, (0, shared_1.encodeTerritoryDelta)({
            tick: r.room.tick,
            baseRevision: conn.territoryRevision,
            revision: nextRevision,
            operations,
        }), "territory_delta", { binary: true, droppable: true });
        if (!sent)
            return;
        conn.territoryRevision = nextRevision;
        conn.territoryCells = current;
    }
    territoryKey(q, r) {
        return `${q},${r}`;
    }
    territoryCellsForConnection(r, conn) {
        let focus = conn.territoryInterest;
        if (!focus && conn.entityId !== null) {
            const entity = r.room.gameState.players[conn.entityId];
            if (entity)
                focus = { x: entity.pos.x, y: entity.pos.y };
        }
        if (!focus)
            return [];
        return (0, territory_aoi_1.filterTerritoryAoi)(r.room.gameState.territoryCells(), new Set(conn.territoryCells.keys()), focus, shared_1.CONFIG.HEX_SIZE, config_1.TERRITORY_AOI_RADIUS, config_1.TERRITORY_AOI_HYSTERESIS);
    }
    broadcastMinimapTerritory(r) {
        for (const ws of r.conns)
            this.sendMinimapTerritory(ws, r);
    }
    sendMinimapTerritory(ws, r) {
        if (ws.readyState !== ws_1.WebSocket.OPEN)
            return;
        const conn = this.conns.get(ws);
        if (!conn || conn.entityId === null)
            return;
        const radarActive = r.room.gameState.radarActiveFor(conn.entityId);
        const cells = r.room.gameState.territoryCells().filter((cell) => radarActive || cell.owner === conn.entityId);
        this.transport.send(ws, (0, shared_1.encodeTerritoryMinimap)(r.room.tick, cells), "territory_minimap", { binary: true, droppable: true });
    }
    emitEvents(r) {
        const gs = r.room.gameState;
        const snap = gs.snapshotEntities();
        for (let i = 0; i < snap.length; i++) {
            const nowAlive = snap[i].alive;
            const wasAlive = r.prevAlive[i] ?? true;
            if (wasAlive && !nowAlive) {
                const ent = gs.players[i];
                this.broadcastControl(r, {
                    t: "event",
                    kind: "death",
                    id: snap[i].id,
                    cause: ent ? ent.deathCause : "",
                    killerId: ent ? ent.killerId : -1,
                });
                const victim = r.matchStats.get(snap[i].id);
                if (victim) {
                    victim.deaths++;
                    victim.deathCause = ent ? ent.deathCause : "";
                }
                if (ent && ent.killerId >= 0) {
                    const killer = r.matchStats.get(ent.killerId);
                    if (killer)
                        killer.kills++;
                }
            }
            r.prevAlive[i] = nowAlive;
        }
        const king = gs.kingId();
        if (king !== r.prevKingId) {
            r.prevKingId = king;
            if (king >= 0)
                this.broadcastControl(r, { t: "event", kind: "king", kingId: king });
        }
        if (gs.won && !r.prevWon) {
            r.prevWon = true;
            const finalScores = r.room.worldUiEntities()
                .map((entity) => ({ id: entity.id, score: entity.score }))
                .sort((a, b) => b.score - a.score || a.id - b.id)
                .map((entity, index) => ({ ...entity, placement: index + 1 }));
            this.broadcastControl(r, {
                t: "event",
                kind: "match_end",
                winnerId: gs.winnerId,
                reason: "king_countdown",
                finalScores,
            });
            this.markEnded(r);
        }
    }
    broadcastControl(r, msg) {
        const text = (0, shared_1.encodeControl)(msg);
        for (const ws of r.conns) {
            this.transport.send(ws, text, "control");
        }
    }
    close() {
        clearInterval(this.heartbeatTimer);
        for (const r of this.rooms) {
            r.running = false;
            if (r.timer) {
                clearTimeout(r.timer);
                r.timer = null;
            }
        }
        this.rooms.clear();
        this.active = null;
        for (const session of this.resumeSessions.values()) {
            if (session.timer)
                clearTimeout(session.timer);
        }
        this.resumeSessions.clear();
        for (const ws of this.conns.keys()) {
            try {
                ws.terminate();
            }
            catch {
            }
        }
        this.conns.clear();
        this.connsByIp.clear();
        telemetry_1.serverTelemetry.setRoomsActive(0);
        return new Promise((resolve) => this.wss.close(() => resolve()));
    }
}
exports.NetServer = NetServer;
//# sourceMappingURL=net-server.js.map