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
    join(name = "") {
        for (let id = 0; id < this.maxHumans; id++) {
            if (!this.seats[id]) {
                this.seats[id] = true;
                this.lastSeq[id] = 0;
                this.pending[id] = null;
                this.gs.setName(id, name.trim() || `Người ${id + 1}`);
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
    buildSnapshotFor(entityId) {
        const ack = entityId >= 0 && entityId < this.maxHumans ? this.lastSeq[entityId] : 0;
        const e = this.gs.players[entityId];
        const selfPrep = e && e.phase === "prep" ? Math.max(0, Math.ceil(e.prepRemaining * 1000)) : 0;
        return {
            tick: this.tickCount,
            ackSeq: ack,
            selfPrep,
            entities: this.gs.snapshotEntities(),
        };
    }
}
exports.GameRoom = GameRoom;
//# sourceMappingURL=game-room.js.map