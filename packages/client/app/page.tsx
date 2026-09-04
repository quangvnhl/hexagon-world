"use client";

// Trang chủ: bảng chọn (nhập tên + chế độ). Chọn xong render THẲNG scene chơi ngay trên
// trang — KHÔNG đổi route. Nút "← Menu" trong scene quay lại bảng chọn.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { StartPanel, type GameMode, type PracticeOptions } from "@/components/StartPanel";
import type { PlayerAppearance } from "@hexagon/shared";
import { useTelegramWebApp } from "@/lib/telegram";
import { acquireGameAccess } from "@/lib/backend";
import { track } from "@/lib/analytics";
import { Ftue, ftueAlreadyDone } from "@/components/Ftue";
import { CLAIM_EPSILON_PCT, type FtueSignals } from "@/components/ftueSteps";
import type { Stats } from "@/components/HUD";
import { useConfigFlag, useConfigNumber } from "@/lib/useRemoteConfig";

// R3F chỉ chạy phía client → tắt SSR cho các scene.
const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false });
const NetGameScene = dynamic(() => import("@/components/NetGameScene"), {
  ssr: false,
});
const CampaignScene = dynamic(() => import("@/components/CampaignScene"), {
  ssr: false,
});

interface Session {
  mode: GameMode;
  name: string;
  serverUrl: string;
  appearance: PlayerAppearance;
  gameTicket?: string;
  /** Số bot cho mode Luyện tập (solo); bỏ qua khi online. */
  botCount?: number;
}

/** Tâm sân — ô xuất phát của ván hướng dẫn. Xem `spawnAt` ở `GameScene` để biết vì sao. */
const FTUE_SPAWN = { q: 0, r: 0 } as const;

/**
 * Trạng thái FTUE (doc 35 §D1). Người mới → vào THẲNG một ván Luyện tập có dẫn dắt, không qua
 * bảng chọn và **không bắt đăng nhập**.
 *
 * `active` khởi tạo bằng `false` chứ không đọc localStorage ngay: trang này render cả trên server
 * (Next 15), nên đọc storage lúc dựng sẽ lệch hydrate. Đọc trong `useEffect` ⇒ khung hình đầu
 * luôn là bảng chọn, sau đó mới chuyển sang hướng dẫn nếu là người mới.
 */
function useFtue() {
  const [active, setActive] = useState(false);
  const enabled = useConfigFlag("ftue.enabled");
  const botCount = useConfigNumber("ftue.bot_count");
  const targetPct = useConfigNumber("ftue.step3_target_pct");
  const claimsNeeded = useConfigNumber("ftue.step3_claims");
  // Dữ kiện thô lấy từ ván đang chạy. `startPct` là % đất SINH RA SẴN quanh chỗ xuất phát —
  // chốt ở nhịp đo đầu tiên rồi giữ nguyên, để bước 2 so với nó chứ không so với 0.
  const [signals, setSignals] = useState<FtueSignals>({ steered: false, pct: 0, startPct: -1, claims: 0 });
  // Mốc % cao nhất từng đạt. Đếm "khép được một vòng" = vượt mốc cũ, chứ không phải "pct tăng":
  // sau khi chết `pct` bò lên lại từ 0 và cách đếm ngây thơ sẽ cộng thêm hàng loạt lần chiếm ma.
  const peakPct = useRef(-1);

  useEffect(() => {
    if (!enabled || ftueAlreadyDone()) return;
    setActive(true);
  }, [enabled]);

  const onStats = useCallback((s: Stats) => {
    setSignals((prev) => {
      const startPct = prev.startPct < 0 ? s.pct : prev.startPct;
      if (peakPct.current < 0) peakPct.current = startPct;
      let claims = prev.claims;
      if (s.pct > peakPct.current + CLAIM_EPSILON_PCT) {
        claims += 1;
        peakPct.current = s.pct;
      }
      const next = { steered: Boolean(s.steered), pct: s.pct, startPct, claims };
      // Bỏ qua nếu không đổi gì đáng kể — `onStats` chạy vài lần/giây, và mỗi `setState` khác
      // tham chiếu sẽ render lại cả cây scene.
      if (prev.steered === next.steered && prev.startPct === startPct && prev.claims === claims
          && Math.abs(prev.pct - next.pct) < 0.001) return prev;
      return next;
    });
  }, []);

  const finish = useCallback(() => {
    setActive(false);
    peakPct.current = -1;
    setSignals({ steered: false, pct: 0, startPct: -1, claims: 0 });
  }, []);

  return { active, botCount, thresholds: { claims: claimsNeeded, targetPct }, signals, onStats, finish };
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const back = useCallback(() => setSession(null), []);
  const ftue = useFtue();
  const isTelegram = useTelegramWebApp(Boolean(session), back);
  const start = useCallback(async (mode: GameMode, name: string, serverUrl: string, appearance: PlayerAppearance, practice: PracticeOptions) => {
    // doc 35 §A1 — `mode_select` phát NGAY khi bấm, trước cả bước xin vé mạng: nếu chỉ đo lúc vào
    // được trận thì mọi lần chọn "online" rồi hỏng mạng sẽ biến mất, và tỉ lệ chọn chế độ sẽ đẹp
    // hơn sự thật đúng ở chỗ đang có vấn đề.
    track("mode_select", { mode });
    if (mode === "online") {
      const access = await acquireGameAccess(name, appearance);
      setSession({ mode, name, serverUrl: access.serverUrl, appearance, gameTicket: access.ticket });
      track("match_start", { mode });
      return;
    }
    if (mode === "campaign") {
      setSession({ mode, name, serverUrl, appearance });
      return; // `campaign_level_start` phát ở màn chọn cấp, không phải ở đây.
    }
    setSession({ mode, name, serverUrl, appearance, botCount: practice.botCount });
    track("match_start", { mode, bot_count: practice.botCount });
  }, []);

  // Người mới: ván Luyện tập có dẫn dắt, chen TRƯỚC bảng chọn. Không đụng tới `session` nên
  // thoát/hoàn thành hướng dẫn là rơi thẳng về bảng chọn như bình thường.
  if (ftue.active) {
    return (
      <>
        <GameScene
          // Không có tên thì ghế 0 nhận tên bot mặc định ("Bot Lam") và bảng xếp hạng của ván
          // hướng dẫn hiện người mới như một con bot. FTUE chạy TRƯỚC đăng nhập nên chưa có tên thật.
          playerName="Bạn"
          botCount={ftue.botCount}
          spawnAt={FTUE_SPAWN}
          onStatsChange={ftue.onStats}
          onExit={() => ftue.finish()}
          showMenu={false}
        />
        <Ftue signals={ftue.signals} thresholds={ftue.thresholds} onFinish={() => ftue.finish()} />
      </>
    );
  }

  if (!session) {
    return (
      <StartPanel
        onStart={start}
      />
    );
  }

  if (session.mode === "online") {
    return (
      <NetGameScene
        playerName={session.name}
        appearance={session.appearance}
        serverUrl={session.serverUrl}
        gameTicket={session.gameTicket}
        onExit={back}
        showMenu={!isTelegram}
      />
    );
  }

  if (session.mode === "campaign") {
    return (
      <CampaignScene
        playerName={session.name}
        appearance={session.appearance}
        onExit={back}
        showMenu={!isTelegram}
      />
    );
  }
  return (
    <GameScene
      playerName={session.name}
      appearance={session.appearance}
      botCount={session.botCount}
      onExit={back}
      showMenu={!isTelegram}
    />
  );
}
