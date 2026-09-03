// Barrel của gói dùng chung (@hexagon/shared): toán hex, luật flood fill, GameState
// deterministic, cấu hình, hình học sân, protocol mạng, và spatial hash.
// DÙNG CHUNG giữa client (render/predict) và server (authoritative).
export * from "./hex";
export * from "./floodfill";
export * from "./config";
export * from "./match-config";
export * from "./campaign";
export * from "./energy";
export * from "./analytics";
export * from "./arena";
export * from "./state";
export * from "./protocol";
export * from "./protocol-version";
export * from "./spatialhash";
export * from "./totems";
