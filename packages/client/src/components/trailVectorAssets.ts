import type { TrailPattern } from "@hexagon/shared";

/**
 * Registry thiết kế đuôi vector. SVG chỉ chứa màu trắng/alpha; material 3D và
 * CSS preview sẽ tint bằng màu nhân vật, nên asset không được tự đặt màu gameplay.
 */
export const TRAIL_VECTOR_ASSETS: Record<TrailPattern, string | null> = {
  solid: null,
  stripes: "/trails/stripes.svg",
  dots: "/trails/dots.svg",
  chevrons: "/trails/chevrons.svg",
};

export function trailVectorAsset(pattern: TrailPattern): string | null {
  return TRAIL_VECTOR_ASSETS[pattern];
}
