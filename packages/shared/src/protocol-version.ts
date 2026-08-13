/** Increment when client and game server wire formats are not mutually compatible. */
export const GAME_PROTOCOL_VERSION = 3;

export interface ProtocolJoinMetadata {
  protocolVersion: number;
}
