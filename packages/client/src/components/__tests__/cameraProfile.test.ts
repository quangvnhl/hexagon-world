import { describe, expect, it } from "vitest";
import { CONFIG } from "@hexagon/shared";
import { cameraFov, cameraProfileName } from "../cameraProfile";

describe("camera profiles", () => {
  it("separates desktop, mobile portrait and mobile landscape", () => {
    expect(cameraProfileName(false, 1920, 1080)).toBe("DESKTOP");
    expect(cameraProfileName(true, 390, 844)).toBe("MOBILE_PORTRAIT");
    expect(cameraProfileName(true, 844, 390)).toBe("MOBILE_LANDSCAPE");
  });

  it("applies each profile view scale to its FOV", () => {
    expect(cameraFov("DESKTOP", 1920, 1080)).toBeCloseTo(CONFIG.CAMERA.FOV);
    const expectedPortrait =
      (Math.atan(
        Math.tan((CONFIG.CAMERA.FOV * Math.PI) / 360) *
          CONFIG.CAMERA.PROFILES.MOBILE_PORTRAIT.VIEW_SCALE
      ) *
        360) /
      Math.PI;
    expect(cameraFov("MOBILE_PORTRAIT", 390, 844)).toBeCloseTo(
      expectedPortrait
    );
  });

  it("preserves the previous mobile landscape FOV formula", () => {
    const width = 844;
    const height = 390;
    const aspect = width / height;
    const expected =
      (Math.atan(
        (Math.tan((CONFIG.CAMERA.FOV * Math.PI) / 360) *
          (1 / aspect) *
          CONFIG.CAMERA.PROFILES.MOBILE_LANDSCAPE.VIEW_SCALE) /
          aspect
      ) *
        360) /
      Math.PI;

    expect(cameraFov("MOBILE_LANDSCAPE", width, height)).toBeCloseTo(expected);
  });
});
