import { useEffect, useState } from "react";
import { CONFIG } from "@hexagon/shared";

export type CameraProfileName = keyof typeof CONFIG.CAMERA.PROFILES;

export function cameraProfileName(
  coarsePointer: boolean,
  width: number,
  height: number
): CameraProfileName {
  if (!coarsePointer) return "DESKTOP";
  return width > height ? "MOBILE_LANDSCAPE" : "MOBILE_PORTRAIT";
}

/** Giữ nguyên công thức mobile ngang cũ; các profile khác dùng FOV chuẩn khi scale = 1. */
export function cameraFov(
  profileName: CameraProfileName,
  width: number,
  height: number
): number {
  const aspect = width / Math.max(height, 1);
  const viewScale = CONFIG.CAMERA.PROFILES[profileName].VIEW_SCALE;
  const baseHalfFov = Math.tan((CONFIG.CAMERA.FOV * Math.PI) / 360);

  if (profileName === "MOBILE_LANDSCAPE") {
    const portraitAspect = 1 / Math.max(aspect, Number.EPSILON);
    return (Math.atan((baseHalfFov * portraitAspect * viewScale) / aspect) * 360) / Math.PI;
  }

  return (Math.atan(baseHalfFov * viewScale) * 360) / Math.PI;
}

export function useCameraProfile(width: number, height: number) {
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const name = cameraProfileName(coarsePointer, width, height);
  return { name, settings: CONFIG.CAMERA.PROFILES[name] };
}
