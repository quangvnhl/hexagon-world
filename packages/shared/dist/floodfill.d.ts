import { HexKey } from "./hex";
/**
 * Thuật toán chiếm đất kiểu "bao vây" (flood fill từ biên ngoài).
 *
 * Ý tưởng: coi (owned ∪ trail) là hàng rào (barrier). Loang từ mọi ô "biên bản đồ"
 * (ô mà bản thân nó không có đủ 6 láng giềng nằm trong map — tức nằm ở rìa) và không
 * thuộc barrier → ra tập `outside`. Ô nào của bản đồ không thuộc barrier và không
 * thuộc `outside` thì bị nhốt bên trong → cần chiếm. Trả về interior ∪ trail.
 *
 * @param mapSet Tập mọi ô hợp lệ của bản đồ.
 * @param owned  Tập ô đang sở hữu.
 * @param trail  Danh sách/tập ô của đuôi vừa vẽ.
 * @returns Tập ô cần thêm vào owned (gồm cả trail).
 */
export declare function captureEnclosed(mapSet: Set<HexKey>, owned: Set<HexKey>, trail: Iterable<HexKey>): Set<HexKey>;
