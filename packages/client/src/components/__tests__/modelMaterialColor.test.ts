import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyPlayerColorToPrimaryMaterials } from "../modelMaterialColor";

describe("applyPlayerColorToPrimaryMaterials", () => {
  it("replaces the color of primary materials without changing emissive", () => {
    const material = new THREE.MeshStandardMaterial({
      color: "#ff0000",
      emissive: "#123456",
    });
    material.name = "primary";
    const originalEmissive = material.emissive.clone();

    const applied = applyPlayerColorToPrimaryMaterials(
      material,
      new THREE.Color("#2f8fe6")
    );

    expect(applied).toBe(true);
    expect(material.color.getHexString()).toBe("2f8fe6");
    expect(material.emissive.equals(originalEmissive)).toBe(true);
  });

  it("leaves non-primary materials unchanged", () => {
    const material = new THREE.MeshStandardMaterial({ color: "#ff6900" });
    material.name = "black";
    const originalColor = material.color.clone();

    const applied = applyPlayerColorToPrimaryMaterials(
      material,
      new THREE.Color("#2f8fe6")
    );

    expect(applied).toBe(false);
    expect(material.color.equals(originalColor)).toBe(true);
  });

  it("matches the primary material name exactly", () => {
    const material = new THREE.MeshStandardMaterial({ color: "#ff6900" });
    material.name = "Primary";
    const originalColor = material.color.clone();

    const applied = applyPlayerColorToPrimaryMaterials(
      material,
      new THREE.Color("#2f8fe6")
    );

    expect(applied).toBe(false);
    expect(material.color.equals(originalColor)).toBe(true);
  });
});
