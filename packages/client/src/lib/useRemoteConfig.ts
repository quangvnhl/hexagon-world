"use client";

import { useEffect, useState } from "react";
import { REMOTE_CONFIG_DEFAULTS, type RemoteConfigKey } from "@hexagon/shared";
import { configFlag, configValue, remoteConfig } from "./remoteConfig";

/**
 * Đọc một khoá cấu hình trong React (doc 35 §A2, lát a2.2).
 *
 * Giá trị khởi tạo CỐ Ý là hằng mặc định chứ không phải giá trị đang có trong bộ đệm. Lý do là
 * hydrate: server render bằng mặc định (không có localStorage), nếu client render lần đầu bằng bản
 * đệm thì hai bên khác nhau và React sẽ cảnh báo/vẽ lại sai. Đọc giá trị thật ở `useEffect` — chạy
 * sau khi hydrate xong nên an toàn.
 *
 * Hệ quả có thể thấy được: trong một khung hình đầu tiên, tính năng bị tắt vẫn hiện. Chấp nhận
 * được với kill-switch (một khung hình) và đổi lại không có lỗi hydrate.
 */
export function useConfigFlag(key: RemoteConfigKey): boolean {
  const [value, setValue] = useState<boolean>(() => Boolean(REMOTE_CONFIG_DEFAULTS[key]));

  useEffect(() => {
    let active = true;
    // Đọc ngay bản đệm (đồng bộ, không chờ mạng) rồi cập nhật lại khi tải xong.
    setValue(configFlag(key));
    void remoteConfig()
      .refresh()
      .then(() => { if (active) setValue(configFlag(key)); })
      .catch(() => { /* cấu hình không bao giờ được làm hỏng màn hình */ });
    return () => { active = false; };
  }, [key]);

  return value;
}

/** Như `useConfigFlag` nhưng cho khoá số. */
export function useConfigNumber(key: RemoteConfigKey): number {
  const [value, setValue] = useState<number>(() => Number(REMOTE_CONFIG_DEFAULTS[key]));

  useEffect(() => {
    let active = true;
    const read = () => {
      const v = configValue(key);
      if (typeof v === "number") setValue(v);
    };
    read();
    void remoteConfig()
      .refresh()
      .then(() => { if (active) read(); })
      .catch(() => { /* bỏ qua */ });
    return () => { active = false; };
  }, [key]);

  return value;
}
