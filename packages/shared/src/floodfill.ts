import { HexKey, parseKey, neighbors, keyOf } from "./hex";

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
export function captureEnclosed(
  mapSet: Set<HexKey>,
  owned: Set<HexKey>,
  trail: Iterable<HexKey>
): Set<HexKey> {
  const barrier = new Set<HexKey>(owned);
  for (const t of trail) barrier.add(t);

  // Xác định các ô rìa bản đồ: có ít nhất 1 láng giềng nằm ngoài map.
  const isBorderCell = (k: HexKey): boolean => {
    const a = parseKey(k);
    for (const n of neighbors(a)) {
      if (!mapSet.has(keyOf(n))) return true;
    }
    return false;
  };

  // BFS "outside" bắt đầu từ mọi ô rìa không thuộc barrier.
  const outside = new Set<HexKey>();
  const queue: HexKey[] = [];
  for (const k of mapSet) {
    if (barrier.has(k)) continue;
    if (isBorderCell(k)) {
      if (!outside.has(k)) {
        outside.add(k);
        queue.push(k);
      }
    }
  }

  while (queue.length > 0) {
    const cur = queue.pop() as HexKey;
    const a = parseKey(cur);
    for (const n of neighbors(a)) {
      const nk = keyOf(n);
      if (!mapSet.has(nk)) continue;
      if (barrier.has(nk)) continue;
      if (outside.has(nk)) continue;
      outside.add(nk);
      queue.push(nk);
    }
  }

  // Kết quả: mọi ô map không thuộc outside → chiếm (interior). Cộng thêm trail.
  const result = new Set<HexKey>();
  for (const k of mapSet) {
    if (!outside.has(k)) result.add(k); // gồm cả owned cũ + interior + trail
  }
  for (const t of trail) result.add(t);
  return result;
}
