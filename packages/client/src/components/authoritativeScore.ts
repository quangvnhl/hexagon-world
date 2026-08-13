/**
 * Online scene only holds territory inside camera AoI, so Entity.owned.size is not a score.
 * Prefer the server-wide score and use the scene count only in local/single-player mode.
 */
export function resolvedOwnershipScore(
  entityId: number,
  sceneOwnedSize: number,
  authoritativeScores?: ReadonlyMap<number, number>
): number | undefined {
  return authoritativeScores ? authoritativeScores.get(entityId) : sceneOwnedSize;
}
