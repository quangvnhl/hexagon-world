"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetServer = void 0;
const ws_1 = require("ws");
const node_crypto_1 = require("node:crypto");
const shared_1 = require("@hexagon/shared");
const game_room_1 = require("../game/game-room");
const config_1 = require("../config");
const TERRITORY_EVERY = 6;
const ENDED_GRACE_MS = 8000;
class NetServer {
    constructor(opts = {}) {
        this.autoLoop = false;
        this.nextRoomId = 1;
        this.conns = new Map();
        this.rooms = new Set();
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
        this.wss = opts.httpServer
            ? new ws_1.WebSocketServer({ server: opts.httpServer, ...(opts.path ? { path: opts.path } : {}) })
            : new ws_1.WebSocketServer({ port: opts.port ?? 0 });
        this.wss.on("connection", (ws) => this.onConnection(ws));
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
        return this.active && !this.active.ended ? this.active.room : null;
    }
    get roomCount() {
        return this.rooms.size;
    }
    tickOnce() {
        const r = this.active;
        if (!r || !r.started)
            return;
        this.stepRoom(r);
        this.broadcast(r);
        this.flushTerritoryIfDue(r);
    }
    whenListening() {
        if (this.wss.address())
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            this.wss.once("listening", () => resolve());
            this.wss.once("error", reject);
        });
    }
    ensureActiveRoom() {
        if (!this.active || this.active.ended) {
            const r = {
                id: this.nextRoomId++,
                room: new game_room_1.GameRoom(config_1.MAX_PLAYERS, config_1.ONLINE_BOTS),
                conns: new Set(),
                started: false,
                ended: false,
                endedAt: 0,
                timer: null,
                lastTime: 0,
                accumulator: 0,
                running: false,
                lastTerrRev: -1,
                prevAlive: [],
                prevWon: false,
                prevKingId: -1,
                matchId: null,
                startedAt: null,
                reported: false,
                participants: new Map(),
                matchStats: new Map(),
            };
            r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
            this.rooms.add(r);
            this.active = r;
        }
        return this.active;
    }
    startGame(r) {
        if (r.started || r.ended)
            return;
        r.room.startMatch();
        r.started = true;
        r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
        r.prevWon = false;
        r.prevKingId = -1;
        r.matchId = (0, node_crypto_1.randomUUID)();
        r.startedAt = new Date().toISOString();
        r.reported = false;
        r.participants.clear();
        r.matchStats.clear();
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
        let lastId = -1;
        for (const ws of r.conns) {
            const c = this.conns.get(ws);
            if (c && c.entityId !== null) {
                lastId = c.entityId;
                break;
            }
        }
        const alive = lastId >= 0 && r.room.gameState.players[lastId]?.alive === true;
        if (alive) {
            r.room.gameState.declareWinner(lastId);
            this.broadcastControl(r, { t: "event", kind: "win", winnerId: lastId });
            r.prevWon = true;
            this.markEnded(r);
        }
        else {
            this.revertToWaiting(r);
        }
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
        this.broadcastControl(r, {
            t: "lobby",
            present: r.room.occupied(),
            needed: config_1.MIN_PLAYERS,
            started: r.started,
        });
    }
    broadcastRoster(r) {
        this.broadcastControl(r, { t: "roster", players: r.room.roster() });
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
        if (this.active === r)
            this.active = null;
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
        r.timer = setTimeout(() => this.loop(r), this.tickMs);
    }
    loop(r) {
        if (!r.running)
            return;
        const now = Date.now();
        let elapsed = (now - r.lastTime) / 1000;
        r.lastTime = now;
        if (elapsed > this.dt * 5)
            elapsed = this.dt * 5;
        r.accumulator += elapsed;
        let stepped = false;
        while (r.accumulator >= this.dt) {
            this.stepRoom(r);
            r.accumulator -= this.dt;
            stepped = true;
        }
        if (stepped) {
            this.broadcast(r);
            this.flushTerritoryIfDue(r);
        }
        if (r.ended && Date.now() - r.endedAt > ENDED_GRACE_MS) {
            this.closeRoom(r);
            return;
        }
        this.scheduleNext(r);
    }
    stepRoom(r) {
        r.room.stepTick(this.dt);
        this.emitEvents(r);
    }
    onConnection(ws) {
        this.conns.set(ws, { entityId: null, room: null, identity: null });
        ws.on("message", (data, isBinary) => {
            if (isBinary)
                this.onBinary(ws, data);
            else
                this.onText(ws, data.toString());
        });
        ws.on("close", () => this.onClose(ws));
        ws.on("error", () => this.onClose(ws));
    }
    onBinary(ws, data) {
        const conn = this.conns.get(ws);
        if (!conn || conn.entityId === null || !conn.room)
            return;
        const input = (0, shared_1.decodeInput)(data);
        if (!input)
            return;
        conn.room.room.applyInput(conn.entityId, input.seq, input.heading);
    }
    onText(ws, text) {
        const msg = (0, shared_1.decodeControl)(text);
        if (!msg)
            return;
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        if (msg.t === "join") {
            if (conn.entityId !== null)
                return;
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
            r.conns.add(ws);
            this.send(ws, {
                t: "welcome",
                playerId: id,
                arenaRadius: shared_1.CONFIG.ARENA_RADIUS,
                hexSize: shared_1.CONFIG.HEX_SIZE,
                tickRate: this.tickRate,
                seed: 0,
                maxPlayers: config_1.MAX_PLAYERS,
                botCount: config_1.ONLINE_BOTS,
            });
            this.sendTerritory(ws, r);
            this.broadcastRoster(r);
            if (!r.started && r.room.occupied() >= config_1.MIN_PLAYERS)
                this.startGame(r);
            else
                this.broadcastLobby(r);
        }
        else if (msg.t === "ping") {
            this.send(ws, { t: "pong", time: msg.time });
        }
        else if (msg.t === "revive") {
            if (conn.room && conn.entityId !== null)
                conn.room.room.reviveSeat(conn.entityId);
        }
    }
    onClose(ws) {
        const conn = this.conns.get(ws);
        if (!conn)
            return;
        const r = conn.room;
        if (r && conn.entityId !== null) {
            r.room.leave(conn.entityId);
            r.conns.delete(ws);
            if (r.conns.size === 0) {
                this.closeRoom(r);
            }
            else if (!r.ended && r.started && r.room.occupied() < config_1.MIN_PLAYERS) {
                this.handleLastPlayer(r);
            }
            else if (!r.started) {
                this.broadcastRoster(r);
                this.broadcastLobby(r);
            }
            else {
                this.broadcastRoster(r);
            }
        }
        this.conns.delete(ws);
    }
    send(ws, msg) {
        if (ws.readyState === ws_1.WebSocket.OPEN)
            ws.send((0, shared_1.encodeControl)(msg));
    }
    broadcast(r) {
        for (const ws of r.conns) {
            const conn = this.conns.get(ws);
            if (!conn || conn.entityId === null)
                continue;
            if (ws.readyState !== ws_1.WebSocket.OPEN)
                continue;
            ws.send((0, shared_1.encodeSnapshot)(r.room.buildSnapshotFor(conn.entityId)), {
                binary: true,
            });
        }
    }
    flushTerritoryIfDue(r) {
        const rev = r.room.gameState.territoryRevision;
        if (r.room.tick % TERRITORY_EVERY === 0 || rev !== r.lastTerrRev) {
            r.lastTerrRev = rev;
            this.broadcastTerritory(r);
        }
    }
    broadcastTerritory(r) {
        const buf = (0, shared_1.encodeTerritory)(r.room.tick, r.room.gameState.territoryCells());
        for (const ws of r.conns) {
            if (ws.readyState === ws_1.WebSocket.OPEN)
                ws.send(buf, { binary: true });
        }
    }
    sendTerritory(ws, r) {
        if (ws.readyState !== ws_1.WebSocket.OPEN)
            return;
        ws.send((0, shared_1.encodeTerritory)(r.room.tick, r.room.gameState.territoryCells()), {
            binary: true,
        });
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
            this.broadcastControl(r, {
                t: "event",
                kind: "win",
                winnerId: gs.winnerId,
            });
            this.markEnded(r);
        }
    }
    broadcastControl(r, msg) {
        const text = (0, shared_1.encodeControl)(msg);
        for (const ws of r.conns) {
            if (ws.readyState === ws_1.WebSocket.OPEN)
                ws.send(text);
        }
    }
    close() {
        for (const r of this.rooms) {
            r.running = false;
            if (r.timer) {
                clearTimeout(r.timer);
                r.timer = null;
            }
        }
        this.rooms.clear();
        this.active = null;
        for (const ws of this.conns.keys()) {
            try {
                ws.terminate();
            }
            catch {
            }
        }
        this.conns.clear();
        return new Promise((resolve) => this.wss.close(() => resolve()));
    }
}
exports.NetServer = NetServer;
//# sourceMappingURL=net-server.js.map