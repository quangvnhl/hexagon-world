import * as THREE from "three";
import type { Vec2 } from "@hexagon/shared";

/** Dựng ribbon phẳng trong mặt XY; UV.u tăng theo chiều dài để SVG lặp không bị kéo giãn. */
export function createTrailRibbonGeometry(points: readonly Vec2[], width = 0.44): THREE.BufferGeometry {
  const vectors = points.map((point) => new THREE.Vector3(point.x, point.y, 0.09));
  const curve = new THREE.CatmullRomCurve3(vectors);
  const segments = Math.min(160, Math.max(8, Math.ceil(points.length * 1.5)));
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = new Uint16Array(segments * 6);
  const current = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  let distance = 0;

  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    curve.getPoint(t, current);
    curve.getTangent(t, tangent).normalize();
    if (index > 0) distance += current.distanceTo(previous);
    previous.copy(current);
    const nx = -tangent.y * width * 0.5;
    const ny = tangent.x * width * 0.5;
    const vertex = index * 2;
    positions.set([current.x + nx, current.y + ny, current.z], vertex * 3);
    positions.set([current.x - nx, current.y - ny, current.z], (vertex + 1) * 3);
    const u = distance / 1.15;
    uvs.set([u, 0], vertex * 2);
    uvs.set([u, 1], (vertex + 1) * 2);
    if (index < segments) {
      const offset = index * 6;
      const next = vertex + 2;
      indices.set([vertex, vertex + 1, next, vertex + 1, next + 1, next], offset);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
