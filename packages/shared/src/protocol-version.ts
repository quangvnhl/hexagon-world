/** Increment when client and game server wire formats are not mutually compatible. */
export const GAME_PROTOCOL_VERSION = 6;

export interface ProtocolJoinMetadata {
  protocolVersion: number;
}
