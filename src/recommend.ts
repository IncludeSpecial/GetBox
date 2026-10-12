import type { MergedApp, ProfileEntry } from './types';

/** Curated relations between catalog apps (data/related.json), keyed by catalog id. */
export interface RelatedData {
  /** Apps people tend to use together. */
  stacks: Array<{ id: string; apps: string[] }>;
  /** Interchangeable apps: owning one makes the others less relevant. */
  alternatives: Array<{ id: string; apps: string[] }>;
}

export type RecommendationReason =
  | { kind: 'favorite' }
  | { kind: 'pairs'; withName: string }
  | { kind: 'category'; category: string }
  | { kind: 'editor'; tag?: string }
  | { kind: 'popular' };

export interface Recommendation {
  app: MergedApp;
  score: number;
  reason: RecommendationReason;
}

export interface Recommender {
  /** Apps to suggest next, best first; editorial picks when the user owns nothing yet. */
  forYou(limit?: number): Recommendation[];
  /** Apps from the same stacks and profiles, most shared groups first. */
  pairsWith(app: MergedApp, limit?: number): MergedApp[];
  /** Apps that do the same job. */
  alternativesTo(app: MergedApp, limit?: number): MergedApp[];
  /** Whether the user has installed or starred anything the catalog knows. */
  personalized: boolean;
}

const WEIGHT = {
  pairOwned: 2,
  pairLiked: 1,
  categoryShare: 1.5,
  pick: 1,
  recommended: 0.6,
  favorite: 3,
  /** Multiplier when the user already owns an alternative. */
  alternativeOwned: 0.3,
};

/**
 * Score catalog apps for one user from what they installed and starred.
 * Pure: everything comes in as arguments, so it runs in the renderer and in tests.
 */
export function buildRecommender(apps: MergedApp[], related: RelatedData, profiles: ProfileEntry[] = []): Recommender {
  const curated = apps.filter((a) => a.curatedId);
  const byCatalogId = new Map(curated.map((a) => [a.curatedId!, a]));
  const byPackageId = new Map(curated.map((a) => [a.id, a]));

  // Profiles are hand-picked install bundles, i.e. stacks too (they reference package ids).
  const stacks: string[][] = [
    ...related.stacks.map((s) => s.apps),
    ...profiles.map((p) => p.packages.map((pkg) => byPackageId.get(pkg.packageId)?.curatedId).filter(Boolean) as string[]),
  ].map((group) => group.filter((id) => byCatalogId.has(id)));
  const alternatives = related.alternatives.map((g) => g.apps.filter((id) => byCatalogId.has(id)));

  const groupsOf = (groups: string[][], id: string) => groups.filter((g) => g.includes(id));
  const owned = new Set(curated.filter((a) => a.isInstalled).map((a) => a.curatedId!));
  const liked = new Set(curated.filter((a) => a.isFavorite && !a.isInstalled).map((a) => a.curatedId!));
  const personalized = owned.size + liked.size > 0;

  const ownedPerCategory = new Map<string, number>();
  for (const id of owned) {
    const category = byCatalogId.get(id)?.category;
    if (category) ownedPerCategory.set(category, (ownedPerCategory.get(category) ?? 0) + 1);
  }

  function score(app: MergedApp): Recommendation {
    const id = app.curatedId!;
    // Which owned/liked app shares the most stacks with this one — it names the reason.
    const anchors = new Map<string, number>();
    let pairScore = 0;
    for (const group of groupsOf(stacks, id)) {
      for (const other of group) {
        if (other === id) continue;
        if (owned.has(other)) {
          pairScore += WEIGHT.pairOwned;
          anchors.set(other, (anchors.get(other) ?? 0) + WEIGHT.pairOwned);
        } else if (liked.has(other)) {
          pairScore += WEIGHT.pairLiked;
          anchors.set(other, (anchors.get(other) ?? 0) + WEIGHT.pairLiked);
        }
      }
    }
    // Diminishing returns: five shared stacks are not five times as convincing.
    pairScore = Math.sqrt(pairScore) * 2;

    const categoryShare = owned.size && app.category ? (ownedPerCategory.get(app.category) ?? 0) / owned.size : 0;
    const editorial = (app.pickTag ? WEIGHT.pick : 0) + (app.recommended ? WEIGHT.recommended : 0);
    const isLiked = liked.has(id);

    let total = pairScore + categoryShare * WEIGHT.categoryShare + editorial + (isLiked ? WEIGHT.favorite : 0);
    const hasOwnedAlternative = groupsOf(alternatives, id).some((g) => g.some((other) => other !== id && owned.has(other)));
    if (hasOwnedAlternative && !isLiked) total *= WEIGHT.alternativeOwned;

    let reason: RecommendationReason;
    const anchor = [...anchors.entries()].sort((a, b) => b[1] - a[1])[0];
    if (isLiked) reason = { kind: 'favorite' };
    else if (anchor) reason = { kind: 'pairs', withName: byCatalogId.get(anchor[0])!.name };
    else if (categoryShare > 0 && app.category) reason = { kind: 'category', category: app.category };
    else if (editorial > 0) reason = { kind: 'editor', tag: app.pickTag };
    else reason = { kind: 'popular' };

    return { app, score: total, reason };
  }

  const byScore = (a: Recommendation, b: Recommendation) => b.score - a.score || a.app.name.localeCompare(b.app.name);

  return {
    personalized,
    forYou(limit = 24) {
      return curated
        .filter((a) => !a.isInstalled)
        .map(score)
        .filter((r) => r.score > 0)
        .sort(byScore)
        .slice(0, limit);
    },
    pairsWith(app, limit = 6) {
      const id = app.curatedId;
      if (!id) return [];
      const altIds = new Set(groupsOf(alternatives, id).flat());
      const counts = new Map<string, number>();
      for (const group of groupsOf(stacks, id)) {
        for (const other of group) {
          if (other !== id && !altIds.has(other)) counts.set(other, (counts.get(other) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([other, count]) => ({ app: byCatalogId.get(other)!, count }))
        .sort(
          (a, b) =>
            Number(a.app.isInstalled) - Number(b.app.isInstalled) ||
            b.count - a.count ||
            a.app.name.localeCompare(b.app.name),
        )
        .slice(0, limit)
        .map((x) => x.app);
    },
    alternativesTo(app, limit = 6) {
      const id = app.curatedId;
      if (!id) return [];
      const ids = new Set(groupsOf(alternatives, id).flat());
      ids.delete(id);
      return [...ids]
        .map((other) => byCatalogId.get(other)!)
        .sort(
          (a, b) =>
            Number(Boolean(b.pickTag || b.recommended)) - Number(Boolean(a.pickTag || a.recommended)) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, limit);
    },
  };
}
