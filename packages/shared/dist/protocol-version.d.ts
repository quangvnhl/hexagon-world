/** Increment when client and game server wire formats are not mutually compatible. */
export declare const GAME_PROTOCOL_VERSION = 6;
export interface ProtocolJoinMetadata {
    protocolVersion: number;
}
