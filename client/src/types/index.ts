export interface AiExplanation {
  id: string;
  patentId: string;
  reason: string;
  similarAspects: string;
  overlap: string;
  confidence: 'low' | 'medium' | 'high';
  confidenceReason: string | null;
}

export interface Patent {
  id: string;
  analysisId: string;
  patentNumber: string;
  title: string;
  publicationDate: string | null;
  assignee: string | null;
  abstract: string | null;
  source: string;
  relevanceScore: number;
  retrievalMethod: string;
  estimatedExpiry: string | null;
  isExpired: boolean;
  userFlagged: boolean;
  userReviewed: boolean;
  aiExplanation: AiExplanation | null;
  createdAt: string;
}

export interface Report {
  id: string;
  analysisId: string;
  executiveSummary: string;
  keySimilarPatents: string;
  noveltyConcerns: string;
  manualReviewList: string;
  recommendation: string;
  rationale: string;
  createdAt: string;
}

export interface Analysis {
  id: string;
  smiles: string;
  compoundName: string | null;
  formula: string | null;
  molecularWeight: number | null;
  pubchemCid: number | null;
  target: string | null;
  disease: string | null;
  status: string;
  recommendation: string | null;
  createdAt: string;
  updatedAt: string;
  patents?: Patent[];
  report?: Report | null;
  _count?: { patents: number };
}
