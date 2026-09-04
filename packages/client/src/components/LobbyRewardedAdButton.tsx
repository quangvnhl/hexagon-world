"use client";

import { useEffect, useState } from "react";
import {
  isAdsgramPlacementAvailable,
  showAdsgramAd,
} from "@/lib/adsgram";
import { useConfigFlag } from "@/lib/useRemoteConfig";

export function LobbyRewardedAdButton() {
  // Kill-switch (doc 35 §A2): tắt quảng cáo từ database, không cần deploy.
  const adsEnabled = useConfigFlag("ads.enabled");
  const [available, setAvailable] = useState(false);
  const [showing, setShowing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setAvailable(isAdsgramPlacementAvailable("rewarded-lobby-random"));
  }, []);

  if (!adsEnabled || !available) return null;

  const show = async () => {
    if (showing) return;
    setShowing(true);
    setMessage("");
    const result = await showAdsgramAd("rewarded-lobby-random");
    setShowing(false);
    setMessage(
      result === "completed"
        ? "Cảm ơn bạn đã xem quảng cáo."
        : "Hiện chưa có quảng cáo phù hợp, bạn vẫn có thể chơi bình thường."
    );
  };

  return (
    <div style={{ marginTop: 10, textAlign: "center" }}>
      <button
        type="button"
        onClick={() => void show()}
        disabled={showing}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 999,
          border: "1px solid rgba(178,126,255,.45)",
          color: "#eadcff",
          background: "linear-gradient(90deg,rgba(119,74,190,.3),rgba(82,54,148,.22))",
          cursor: showing ? "wait" : "pointer",
          opacity: showing ? 0.68 : 1,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 0.5,
        }}
      >
        {showing ? "ĐANG MỞ QUẢNG CÁO…" : "🎁 XEM QUẢNG CÁO"}
      </button>
      {message && (
        <div role="status" style={{ marginTop: 6, fontSize: 10, opacity: 0.68 }}>
          {message}
        </div>
      )}
    </div>
  );
}

