import * as THREE from "three";

export const PLAYER_COLOR_MATERIAL_NAME = "primary";

/** Apply the selected player color only to explicitly customizable model materials. */
export function applyPlayerColorToPrimaryMaterials(
  materialOrMaterials: THREE.Material | THREE.Material[],
  color: THREE.Color
): boolean {
  const materials = Array.isArray(materialOrMaterials)
    ? materialOrMaterials
    : [materialOrMaterials];
  let applied = false;

  for (const material of materials) {
    if (material.name !== PLAYER_COLOR_MATERIAL_NAME) continue;
    if (!("color" in material) || !(material.color instanceof THREE.Color)) continue;

    material.color.copy(color);
    applied = true;
  }

  return applied;
}
