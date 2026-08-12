import * as THREE from "three";

export interface GroundView {
  x: number;
  y: number;
  radius: number;
}

const direction = new THREE.Vector3();

/**
 * Conservative circle covering the camera footprint on the z=0 gameplay plane.
 * It is intentionally padded so objects do not pop at the edge of the screen.
 */
export function getCameraGroundView(
  camera: THREE.Camera,
  width: number,
  height: number,
  out: GroundView,
  padding = 3
): GroundView {
  camera.getWorldDirection(direction);
  const dz = Math.abs(direction.z) > 0.001 ? direction.z : -1;
  const distanceToGround = Math.max(0, -camera.position.z / dz);
  out.x = camera.position.x + direction.x * distanceToGround;
  out.y = camera.position.y + direction.y * distanceToGround;

  if (camera instanceof THREE.PerspectiveCamera) {
    const halfHeight =
      distanceToGround * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const aspect = width / Math.max(height, 1);
    out.radius = Math.hypot(halfHeight, halfHeight * aspect) * 1.28 + padding;
  } else {
    out.radius = Math.max(width, height) * 0.5 + padding;
  }
  return out;
}

export function isInGroundView(
  view: GroundView,
  x: number,
  y: number,
  margin = 0
): boolean {
  const dx = x - view.x;
  const dy = y - view.y;
  const radius = view.radius + margin;
  return dx * dx + dy * dy <= radius * radius;
}
