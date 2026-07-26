import { GooglePatentResult } from './googlePatents';

export interface ScoredPatent {
  patentNumber: string;
  title: string;
  abstract: string;
  publicationDate: Date | null;
  assignee: string | null;
  source: string;
  relevanceScore: number;
  retrievalMethod: string;
  estimatedExpiry: Date | null;
  isExpired: boolean;
}

/**
 * Score a structural hit from PubChem xrefs.
 * PubChem CID cross-reference = exact match → score 100.
 */
export function scoreStructuralHit(patent: GooglePatentResult): ScoredPatent {
  const pubDate = parseDate(patent.publicationDate);
  const { estimatedExpiry, isExpired } = computeExpiry(pubDate);

  return {
    patentNumber: patent.patentNumber,
    title: patent.title,
    abstract: patent.abstract,
    publicationDate: pubDate,
    assignee: patent.assignee,
    source: 'pubchem_xref',
    relevanceScore: 100, // Exact structural match
    retrievalMethod: 'structural',
    estimatedExpiry,
    isExpired,
  };
}

/**
 * Score a keyword hit using weighted term overlap (TF-based).
 * Capped at 80 (below structural scores by design).
 */
export function scoreKeywordHit(
  patent: GooglePatentResult,
  queryTerms: string[]
): ScoredPatent {
  const pubDate = parseDate(patent.publicationDate);
  const { estimatedExpiry, isExpired } = computeExpiry(pubDate);

  const text = `${patent.title} ${patent.abstract}`.toLowerCase();
  const normalizedTerms = queryTerms
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 2); // Skip very short terms

  if (normalizedTerms.length === 0) {
    return {
      patentNumber: patent.patentNumber,
      title: patent.title,
      abstract: patent.abstract,
      publicationDate: pubDate,
      assignee: patent.assignee,
      source: 'google_patents',
      relevanceScore: 30, // Base score for keyword match
      retrievalMethod: 'keyword',
      estimatedExpiry,
      isExpired,
    };
  }

  // Count how many query terms appear in the patent text
  let matchCount = 0;
  let weightedScore = 0;

  for (const term of normalizedTerms) {
    const regex = new RegExp(escapeRegex(term), 'gi');
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      matchCount++;
      // More occurrences = slightly higher score, but diminishing
      weightedScore += Math.min(matches.length, 5); // Cap at 5 occurrences per term
    }
  }

  const termCoverage = matchCount / normalizedTerms.length; // 0 to 1
  const tfScore = Math.min(weightedScore / normalizedTerms.length, 3); // Normalize

  // Score formula: base (30) + term coverage (0-35) + TF boost (0-15), capped at 80
  const rawScore = 30 + termCoverage * 35 + (tfScore / 3) * 15;
  const relevanceScore = Math.min(Math.round(rawScore), 80);

  return {
    patentNumber: patent.patentNumber,
    title: patent.title,
    abstract: patent.abstract,
    publicationDate: pubDate,
    assignee: patent.assignee,
    source: 'google_patents',
    relevanceScore,
    retrievalMethod: 'keyword',
    estimatedExpiry,
    isExpired,
  };
}

/**
 * Merge and deduplicate patents from structural and keyword retrieval.
 * Patents found by both methods get combined scores and "both" tags.
 */
export function mergeAndDeduplicate(
  structuralHits: ScoredPatent[],
  keywordHits: ScoredPatent[]
): ScoredPatent[] {
  const patentMap = new Map<string, ScoredPatent>();

  // Add structural hits first (higher priority)
  for (const hit of structuralHits) {
    patentMap.set(normalizePatentNumber(hit.patentNumber), hit);
  }

  // Merge keyword hits
  for (const hit of keywordHits) {
    const key = normalizePatentNumber(hit.patentNumber);
    const existing = patentMap.get(key);

    if (existing) {
      // Found by both methods — combine scores, mark as both
      existing.relevanceScore = Math.min(
        existing.relevanceScore + Math.round(hit.relevanceScore * 0.3),
        100
      );
      existing.retrievalMethod = 'both';
      existing.source = 'both';
      // Keep existing metadata (structural enrichment is more reliable)
    } else {
      patentMap.set(key, hit);
    }
  }

  // Sort by relevance score descending
  const results = Array.from(patentMap.values());
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results;
}

/**
 * Rule-based risk recommendation (PRD Section 6).
 *
 * IF any structural-match patent has score ≥ 85 AND is not expired  → High Patent Risk
 * ELSE IF any structural-match patent exists (any score)
 *       OR ≥3 keyword-match patents with score ≥ 60              → Requires Expert Review
 * ELSE (no structural hits, weak/no keyword hits)                  → Low Patent Risk
 */
export function computeRecommendation(patents: ScoredPatent[]): {
  recommendation: string;
  rationale: string;
} {
  const activeStructural = patents.filter(
    (p) =>
      (p.retrievalMethod === 'structural' || p.retrievalMethod === 'both') &&
      !p.isExpired
  );
  const allStructural = patents.filter(
    (p) => p.retrievalMethod === 'structural' || p.retrievalMethod === 'both'
  );
  const strongKeyword = patents.filter(
    (p) =>
      (p.retrievalMethod === 'keyword' || p.retrievalMethod === 'both') &&
      p.relevanceScore >= 60
  );

  // Rule 1: Active structural match with high score
  const highScoreActive = activeStructural.filter((p) => p.relevanceScore >= 85);
  if (highScoreActive.length > 0) {
    return {
      recommendation: 'high_risk',
      rationale: `${highScoreActive.length} active structural-match patent(s) with relevance score ≥ 85 found. ` +
        `Patent(s): ${highScoreActive.map((p) => p.patentNumber).join(', ')}. ` +
        `These are exact compound matches in patents that are likely still enforceable.`,
    };
  }

  // Rule 2: Any structural match OR ≥3 strong keyword matches
  if (allStructural.length > 0) {
    const expiredNote = allStructural.filter((p) => p.isExpired).length > 0
      ? ` (${allStructural.filter((p) => p.isExpired).length} are estimated expired, reducing risk)`
      : '';
    return {
      recommendation: 'expert_review',
      rationale: `${allStructural.length} structural-match patent(s) found${expiredNote}. ` +
        `Patent(s): ${allStructural.map((p) => p.patentNumber).join(', ')}. ` +
        `Expert review is recommended to assess actual patent scope and claims.`,
    };
  }

  if (strongKeyword.length >= 3) {
    return {
      recommendation: 'expert_review',
      rationale: `${strongKeyword.length} keyword-match patents with relevance score ≥ 60 found. ` +
        `These suggest significant prior art in this area. Expert review recommended.`,
    };
  }

  // Rule 3: Low risk
  return {
    recommendation: 'low_risk',
    rationale: `No structural patent matches found. ` +
      `${patents.length} total patent(s) identified, ` +
      `${strongKeyword.length} with relevance score ≥ 60. ` +
      `No strong indicators of patent conflict, but standard due diligence is always recommended.`,
  };
}

/**
 * Estimate patent expiry: publication date + 20 years.
 */
function computeExpiry(publicationDate: Date | null): {
  estimatedExpiry: Date | null;
  isExpired: boolean;
} {
  if (!publicationDate) {
    return { estimatedExpiry: null, isExpired: false };
  }

  const expiry = new Date(publicationDate);
  expiry.setFullYear(expiry.getFullYear() + 20);

  return {
    estimatedExpiry: expiry,
    isExpired: expiry < new Date(),
  };
}

/**
 * Parse various date formats from patent sources.
 */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  // Try various formats
  const cleaned = dateStr.trim();

  // Format: YYYYMMDD (Google Patents)
  if (/^\d{8}$/.test(cleaned)) {
    const y = parseInt(cleaned.substring(0, 4));
    const m = parseInt(cleaned.substring(4, 6)) - 1;
    const d = parseInt(cleaned.substring(6, 8));
    return new Date(y, m, d);
  }

  // Format: YYYY-MM-DD or other standard formats
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function normalizePatentNumber(num: string): string {
  return num.replace(/[-\s]/g, '').toUpperCase();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
