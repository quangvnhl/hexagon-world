export type EndScreenMode = "single" | "online";

export function endActionForMode(mode: EndScreenMode): {
  label: string;
  kind: "restart" | "lobby";
} {
  return mode === "online"
    ? { label: "QUAY VỀ LOBBY", kind: "lobby" }
    : { label: "CHƠI LẠI", kind: "restart" };
}
