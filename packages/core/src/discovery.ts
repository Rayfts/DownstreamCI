export interface DiscoveryCandidate {
  repository: string;
  url: string;
  stars: number;
  forks: number;
  archived: boolean;
  isFork: boolean;
  pushedAt?: string;
}

export interface DiscoveryScoreBreakdown {
  dependencyEvidence: number;
  popularity: number;
  activity: number;
  adoption: number;
  forkPenalty: number;
}

export interface RankedDiscoveryCandidate extends DiscoveryCandidate {
  score: number;
  scoreBreakdown: DiscoveryScoreBreakdown;
}

export function rankDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  now = Date.now(),
): RankedDiscoveryCandidate[] {
  return candidates
    .filter((candidate) => !candidate.archived)
    .map((candidate) => {
      const dependencyEvidence = 50;
      const popularity = Math.min(25, Math.log10(Math.max(1, candidate.stars) + 1) * 6);
      const adoption = Math.min(5, Math.log10(Math.max(1, candidate.forks) + 1) * 2);
      const pushedAt = candidate.pushedAt ? Date.parse(candidate.pushedAt) : Number.NaN;
      const ageDays = Number.isFinite(pushedAt) ? Math.max(0, (now - pushedAt) / 86_400_000) : 730;
      const activity = 20 * Math.exp(-ageDays / 365);
      const forkPenalty = candidate.isFork ? 10 : 0;
      const scoreBreakdown = {
        dependencyEvidence,
        popularity: round(popularity),
        activity: round(activity),
        adoption: round(adoption),
        forkPenalty,
      };
      const score = round(
        dependencyEvidence + scoreBreakdown.popularity + scoreBreakdown.activity + scoreBreakdown.adoption - forkPenalty,
      );
      return { ...candidate, score: Math.max(0, Math.min(100, score)), scoreBreakdown };
    })
    .sort((a, b) => b.score - a.score || b.stars - a.stars || a.repository.localeCompare(b.repository));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
