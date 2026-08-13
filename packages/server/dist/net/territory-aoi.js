"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterTerritoryAoi = filterTerritoryAoi;
const shared_1 = require("@hexagon/shared");
function filterTerritoryAoi(cells, knownKeys, focus, hexSize, radius, hysteresis) {
    const enter2 = radius * radius;
    const exit2 = (radius + hysteresis) ** 2;
    return cells.filter((cell) => {
        const p = (0, shared_1.axialToPixel)(cell, hexSize);
        const dx = p.x - focus.x;
        const dy = p.y - focus.y;
        return dx * dx + dy * dy <=
            (knownKeys.has(`${cell.q},${cell.r}`) ? exit2 : enter2);
    });
}
//# sourceMappingURL=territory-aoi.js.map