import { HexKey } from "./hex";
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
export declare function captureEnclosed(mapSet: Set<HexKey>, owned: Set<HexKey>, trail: Iterable<HexKey>): Set<HexKey>;
