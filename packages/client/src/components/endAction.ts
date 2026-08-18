export type EndScreenMode = "single" | "online" | "campaign";

export function endActionForMode(mode: EndScreenMode): {
  label: string;
  kind: "restart" | "lobby";
} {
  if (mode === "online") return { label: "QUAY VỀ LOBBY", kind: "lobby" };
  if (mode === "campaign") return { label: "VỀ DANH SÁCH CẤP", kind: "lobby" };
  return { label: "CHƠI LẠI", kind: "restart" };
}
