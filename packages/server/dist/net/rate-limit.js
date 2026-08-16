"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlidingWindowCounter = exports.TokenBucket = void 0;
class TokenBucket {
    constructor(capacity, refillPerSec, now = Date.now()) {
        this.capacity = capacity;
        this.refillPerSec = refillPerSec;
        this.tokens = capacity;
        this.last = now;
    }
    tryConsume(now = Date.now()) {
        this.refill(now);
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
    refill(now) {
        if (now <= this.last)
            return;
        const elapsedSec = (now - this.last) / 1000;
        this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
        this.last = now;
    }
}
exports.TokenBucket = TokenBucket;
class SlidingWindowCounter {
    constructor(max, windowMs) {
        this.max = max;
        this.windowMs = windowMs;
        this.hits = [];
    }
    record(now = Date.now()) {
        const cutoff = now - this.windowMs;
        while (this.hits.length > 0 && this.hits[0] <= cutoff)
            this.hits.shift();
        this.hits.push(now);
        return this.hits.length <= this.max;
    }
}
exports.SlidingWindowCounter = SlidingWindowCounter;
//# sourceMappingURL=rate-limit.js.map