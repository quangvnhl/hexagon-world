"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameRoom = void 0;
const shared_1 = require("@hexagon/shared");
const config_1 = require("../config");
class GameRoom {
    constructor(maxHumans = config_1.MAX_PLAYERS, botCount = config_1.BOT_COUNT) {
        this.tickCount = 0;
        this.maxHumans = maxHumans;
        this.gs = new shared_1.GameState(undefined, botCount, maxHumans);
        this.seats = new Array(maxHumans).fill(false);
        this.lastSeq = new Array(maxHumans).fill(0);
        this.pending = new Array(maxHumans).fill(null);
        for (let id = 0; id < maxHumans; id++)
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
    worldUiEntities() {
        return this.gs.snapshotEntities()
            .filter((e) => e.id >= this.maxHumans || this.seats[e.id])
            .map((e) => ({
            id: e.id,
            x: e.x,
            y: e.y,
            alive: e.alive,
            score: e.score,
            colorIndex: e.colorIndex,
            trailPatternIndex: e.trailPatternIndex,
            shapeIndex: e.shapeIndex,
        }));
    }
    reviveSeat(entityId) {
        if (entityId < 0 || entityId >= this.maxHumans)
            return false;
        if (!this.seats[entityId])
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
        this.gs.update(dt);
        this.tickCount++;
    }
    buildSnapshotFor(entityId, entityAoiRadius = Number.POSITIVE_INFINITY, interestTargetId = null) {
        const ack = entityId >= 0 && entityId < this.maxHumans ? this.lastSeq[entityId] : 0;
        const e = this.gs.players[entityId];
        const selfPrep = e && e.phase === "prep" ? Math.max(0, Math.ceil(e.prepRemaining * 1000)) : 0;
        const allEntities = this.gs.snapshotEntities();
        let entities = allEntities;
        if (Number.isFinite(entityAoiRadius) && entityAoiRadius > 0) {
            const self = allEntities.find((entity) => entity.id === entityId);
            const isParticipating = (id) => id >= this.maxHumans || Boolean(this.seats[id]);
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
            kingHold: this.gs.kingHoldRemaining,
            entities,
        };
    }
}
exports.GameRoom = GameRoom;
//# sourceMappingURL=game-room.js.map