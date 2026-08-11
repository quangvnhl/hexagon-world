import { HexKey, parseKey, neighbors, keyOf } from "./hex";

/**
 * Thuật toán chiếm đất kiểu "bao vây" (flood fill từ biên ngoài).
 *
 * Ý tưởng: coi (owned ∪ trail) là hàng rào (barrier). Loang "outside" từ ngoài vào; ô nào
 * KHÔNG với tới được từ ngoài (bị hàng rào nhốt) → interior → chiếm. Trả về owned ∪ interior
 * ∪ trail (giữ nguyên hợp đồng cũ; claimCell với ô đã sở hữu là no-op nên vô hại).
 *
 * HIỆU NĂNG: chỉ loang trong CỬA SỔ = hộp bao (bbox) của barrier nới thêm 1 vành, thay vì
 * quét TOÀN bản đồ. interior luôn nằm trong hộp bao của barrier ⇒ kết quả TƯƠNG ĐƯƠNG bản
 * quét toàn map, nhưng rẻ hơn nhiều lần khi lãnh thổ nhỏ (đông bot lúc đầu ván). Trước đây
 * mỗi lần khép vòng quét cả ~8000 ô ⇒ ~9.6 ms/lần ⇒ nhiều bot khép vòng cùng tick = ĐƠ khung.
 *
 * @param mapSet Tập mọi ô hợp lệ của bản đồ.
 * @param owned  Tập ô đang sở hữu.
 * @param trail  Danh sách/tập ô của đuôi vừa vẽ.
 * @returns Tập ô cần thêm vào owned (gồm cả owned cũ + interior + trail).
 */
export function captureEnclosed(
  mapSet: Set<HexKey>,
  owned: Set<HexKey>,
  trail: Iterable<HexKey>
): Set<HexKey> {
  const trailSet: Set<HexKey> =
    trail instanceof Set ? (trail as Set<HexKey>) : new Set<HexKey>(trail);
  const isBarrier = (k: HexKey): boolean => owned.has(k) || trailSet.has(k);

  // Kết quả GIỮ hợp đồng cũ: owned ∪ trail (∪ interior thêm ở dưới).
  const result = new Set<HexKey>(owned);
  for (const t of trailSet) result.add(t);

  // Hộp bao (bbox) của barrier = owned ∪ trail. interior ⊆ hộp này (bị barrier vây).
  let qmin = Infinity,
    qmax = -Infinity,
    rmin = Infinity,
    rmax = -Infinity;
  const acc = (k: HexKey) => {
    const a = parseKey(k);
    if (a.q < qmin) qmin = a.q;
    if (a.q > qmax) qmax = a.q;
    if (a.r < rmin) rmin = a.r;
    if (a.r > rmax) rmax = a.r;
  };
  for (const k of owned) acc(k);
  for (const k of trailSet) acc(k);
  if (qmin === Infinity) return result; // không có barrier → không nhốt được gì
  // Nới 1 vành: các ô vành LUÔN nằm ngoài bbox barrier ⇒ chắc chắn thông ra ngoài (outside).
  qmin--;
  qmax++;
  rmin--;
  rmax++;

  const inWindow = (q: number, r: number) =>
    q >= qmin && q <= qmax && r >= rmin && r <= rmax;

  // Loang "outside" TRONG cửa sổ: hạt giống = ô ở VÀNH cửa sổ, hoặc ô RÌA BẢN ĐỒ (sát biên
  // sân) — đều thông ra ngoài; miễn là không phải barrier. BFS qua ô-map không-barrier.
  const outside = new Set<HexKey>();
  const queue: HexKey[] = [];
  const seed = (k: HexKey) => {
    if (!outside.has(k)) {
      outside.add(k);
      queue.push(k);
    }
  };
  for (let q = qmin; q <= qmax; q++) {
    for (let r = rmin; r <= rmax; r++) {
      const k = keyOf({ q, r });
      if (!mapSet.has(k) || isBarrier(k)) continue;
      let isSeed = q === qmin || q === qmax || r === rmin || r === rmax;
      if (!isSeed) {
        for (const n of neighbors({ q, r })) {
          if (!mapSet.has(keyOf(n))) {
            isSeed = true; // ô rìa bản đồ (có láng giềng ngoài map)
            break;
          }
        }
      }
      if (isSeed) seed(k);
    }
  }

  while (queue.length > 0) {
    const cur = queue.pop() as HexKey;
    for (const n of neighbors(parseKey(cur))) {
      if (!inWindow(n.q, n.r)) continue; // ở trong cửa sổ
      const nk = keyOf(n);
      if (!mapSet.has(nk) || isBarrier(nk) || outside.has(nk)) continue;
      seed(nk);
    }
  }

  // interior = ô-map trong cửa sổ, không barrier, không outside → chiếm.
  for (let q = qmin; q <= qmax; q++) {
    for (let r = rmin; r <= rmax; r++) {
      const k = keyOf({ q, r });
      if (!mapSet.has(k) || isBarrier(k) || outside.has(k)) continue;
      result.add(k);
    }
  }
  return result;
}
