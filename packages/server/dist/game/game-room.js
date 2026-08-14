"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameRoom = void 0;
const shared_1 = require("@hexagon/shared");
const config_1 = require("../config");
class GameRoom {
    constructor(maxHumans = config_1.MAX_HUMAN_PLAYERS, botCount = config_1.BOT_COUNT, kingDurationSeconds = config_1.KING_ROOM_DURATION_SECONDS, matchSeed = 0) {
        this.kingDurationSeconds = kingDurationSeconds;
        this.tickCount = 0;
        this.activeBots = new Set();
        this.kingCountdownRemaining = config_1.KING_ROOM_DURATION_SECONDS;
        this.kingCountdownRunning = false;
        this.maxHumans = maxHumans;
        this.gs = new shared_1.GameState(undefined, botCount, maxHumans, matchSeed);
        this.seats = new Array(maxHumans).fill(false);
        this.lastSeq = new Array(maxHumans).fill(0);
        this.pending = new Array(maxHumans).fill(null);
        this.botIds = Array.from({ length: botCount }, (_, index) => maxHumans + index);
        for (let id = 0; id < maxHumans; id++)
            this.gs.park(id);
        for (const id of this.botIds)
            this.gs.park(id);
    }
    get gameState() {
        return this.gs;
    }
    get tick() {
        return this.tickCount;
    }
    get capacity() {
        return this.maxHumans;
    }
    join(name = "", appearance) {
        for (let id = 0; id < this.maxHumans; id++) {
            if (!this.seats[id]) {
                this.seats[id] = true;
                this.lastSeq[id] = 0;
                this.pending[id] = null;
                this.gs.setName(id, name.trim() || `Người ${id + 1}`);
                this.gs.setAppearance(id, appearance);
                if (this.gs.players[id]?.phase === "dead")
                    this.gs.respawn(id);
                return id;
            }
        }
        return null;
    }
    roster() {
        const out = [];
        for (let id = 0; id < this.maxHumans; id++) {
            if (this.seats[id])
                out.push({ id, name: this.gs.nameOf(id) });
        }
        return out;
    }
    get botCapacity() { return this.botIds.length; }
    get activeBotCount() { return this.activeBots.size; }
    get kingCountdownActive() { return this.kingCountdownRunning; }
    get kingRemaining() { return this.kingCountdownRunning ? this.kingCountdownRemaining : this.kingDurationSeconds; }
    get kingAdmissionLocked() { return this.kingCountdownRunning; }
    activateNextBot() {
        if (this.kingCountdownRunning)
            return null;
        const id = this.botIds.find((candidate) => !this.activeBots.has(candidate));
        if (id === undefined)
            return null;
        if (!this.gs.respawn(id))
            return null;
        this.activeBots.add(id);
        return id;
    }
    trimBots(target) {
        const desired = Math.max(0, Math.min(this.botIds.length, Math.round(target)));
        if (this.activeBots.size <= desired)
            return;
        const candidates = [...this.activeBots].sort((a, b) => {
            const aDead = this.gs.players[a]?.phase === "dead" ? 0 : 1;
            const bDead = this.gs.players[b]?.phase === "dead" ? 0 : 1;
            return aDead - bDead || b - a;
        });
        for (const id of candidates.slice(0, this.activeBots.size - desired)) {
            this.activeBots.delete(id);
            this.gs.park(id);
        }
    }
    worldUiEntities() {
        return this.gs.snapshotEntities()
            .filter((e) => e.id >= this.maxHumans ? this.activeBots.has(e.id) : this.seats[e.id])
            .map((e) => ({
            id: e.id,
            alive: e.alive,
            score: e.score,
            colorIndex: e.colorIndex,
            trailPatternIndex: e.trailPatternIndex,
            shapeIndex: e.shapeIndex,
        }));
    }
    minimapUiEntitiesFor(entityId) {
        const radar = this.gs.radarActiveFor(entityId);
        return this.gs.snapshotEntities()
            .filter((entity) => (entity.id >= this.maxHumans
            ? this.activeBots.has(entity.id)
            : Boolean(this.seats[entity.id])) &&
            (radar || entity.id === entityId))
            .map((entity) => ({
            id: entity.id,
            x: entity.x,
            y: entity.y,
            alive: entity.alive,
        }));
    }
    reviveSeat(entityId) {
        if (entityId < 0 || entityId >= this.maxHumans)
            return false;
        if (!this.seats[entityId])
            return false;
        if (this.kingCountdownRunning)
            return false;
        return this.gs.respawn(entityId);
    }
    leave(entityId) {
        if (entityId < 0 || entityId >= this.maxHumans)
            return;
        this.seats[entityId] = false;
        this.lastSeq[entityId] = 0;
        this.pending[entityId] = null;
        this.gs.setName(entityId, "");
        this.gs.park(entityId);
    }
    occupied() {
        let n = 0;
        for (const s of this.seats)
            if (s)
                n++;
        return n;
    }
    startMatch() {
        this.resetKingCountdown();
        for (let id = 0; id < this.maxHumans; id++) {
            if (!this.seats[id])
                continue;
            this.gs.park(id);
            this.gs.respawn(id);
        }
    }
    parkAll() {
        for (let id = 0; id < this.maxHumans; id++)
            this.gs.park(id);
        for (const id of this.activeBots)
            this.gs.park(id);
        this.activeBots.clear();
        this.resetKingCountdown();
    }
    applyInput(entityId, seq, heading) {
        if (entityId < 0 || entityId >= this.maxHumans)
            return;
        if (!this.seats[entityId])
            return;
        if (!Number.isFinite(heading))
            return;
        const seqU = seq >>> 0;
        const ref = this.pending[entityId]?.seq ?? this.lastSeq[entityId];
        if (seqU <= ref)
            return;
        this.pending[entityId] = { seq: seqU, heading };
    }
    stepTick(dt) {
        for (let id = 0; id < this.maxHumans; id++) {
            const p = this.pending[id];
            if (p && this.seats[id]) {
                this.gs.setTargetHeading(id, p.heading);
                this.lastSeq[id] = p.seq;
            }
            this.pending[id] = null;
        }
        this.gs.won = false;
        this.gs.winnerId = -1;
        this.gs.update(dt);
        const kingId = this.gs.kingId();
        if (kingId >= 0) {
            const participants = this.gs.players.filter((entity) => entity.id >= this.maxHumans ? this.activeBots.has(entity.id) : this.seats[entity.id]);
            const alive = participants.filter((entity) => entity.phase === "playing" || entity.phase === "prep");
            if (participants.length >= 2 && alive.length === 1 && alive[0].id === kingId) {
                this.kingCountdownRunning = true;
                this.kingCountdownRemaining = 0;
                this.gs.declareWinner(kingId);
                this.gs.kingHoldRemaining = 0;
                this.tickCount++;
                return;
            }
            if (!this.kingCountdownRunning) {
                this.kingCountdownRunning = true;
                this.kingCountdownRemaining = this.kingDurationSeconds;
            }
            this.kingCountdownRemaining = Math.max(0, this.kingCountdownRemaining - dt);
            if (this.kingCountdownRemaining <= 0) {
                this.gs.won = false;
                this.gs.winnerId = -1;
                this.gs.declareWinner(kingId);
            }
            else {
                this.gs.won = false;
                this.gs.winnerId = -1;
            }
        }
        else {
            this.resetKingCountdown();
            this.gs.won = false;
            this.gs.winnerId = -1;
        }
        this.gs.kingHoldRemaining = this.kingRemaining;
        this.tickCount++;
    }
    resetKingCountdown() {
        this.kingCountdownRunning = false;
        this.kingCountdownRemaining = this.kingDurationSeconds;
        this.gs.kingHoldRemaining = this.kingDurationSeconds;
    }
    buildSnapshotFor(entityId, entityAoiRadius = Number.POSITIVE_INFINITY, interestTargetId = null) {
        const ack = entityId >= 0 && entityId < this.maxHumans ? this.lastSeq[entityId] : 0;
        const e = this.gs.players[entityId];
        const selfPrep = e && e.phase === "prep" ? Math.max(0, Math.ceil(e.prepRemaining * 1000)) : 0;
        const allEntities = this.gs.snapshotEntities().filter((entity) => entity.id >= this.maxHumans ? this.activeBots.has(entity.id) : Boolean(this.seats[entity.id]));
        let entities = allEntities;
        if (Number.isFinite(entityAoiRadius) && entityAoiRadius > 0) {
            const self = allEntities.find((entity) => entity.id === entityId);
            const isParticipating = (id) => id >= this.maxHumans ? this.activeBots.has(id) : Boolean(this.seats[id]);
            const requestedTarget = interestTargetId !== null && isParticipating(interestTargetId)
                ? allEntities.find((entity) => entity.id === interestTargetId && entity.alive)
                : undefined;
            const leaderId = self?.alive ? -1 : this.gs.leaderId();
            const leader = leaderId >= 0
                ? allEntities.find((entity) => entity.id === leaderId)
                : undefined;
            const focus = self?.alive ? self : requestedTarget ?? leader ?? self;
            if (focus) {
                const radiusSq = entityAoiRadius * entityAoiRadius;
                const kingId = this.gs.kingId();
                entities = allEntities.filter((entity) => {
                    if (!isParticipating(entity.id))
                        return false;
                    if (entity.id === entityId || entity.id === kingId)
                        return true;
                    const dx = entity.x - focus.x;
                    const dy = entity.y - focus.y;
                    return dx * dx + dy * dy <= radiusSq;
                });
            }
            else {
                entities = self ? [self] : [];
            }
        }
        return {
            tick: this.tickCount,
            ackSeq: ack,
            selfPrep,
            kingRemaining: this.kingRemaining,
            entities,
        };
    }
}
exports.GameRoom = GameRoom;
//# sourceMappingURL=game-room.js.map