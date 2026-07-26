import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { resolveSmiles, getPatentXrefs } from '../services/pubchem';
import { searchPatents, enrichPatent } from '../services/googlePatents';
import {
  scoreStructuralHit,
  scoreKeywordHit,
  mergeAndDeduplicate,
  computeRecommendation,
  ScoredPatent,
} from '../services/scoring';
import { explainPatent, generateReport } from '../services/groq';
import { generatePdf } from '../utils/pdf';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /api/analyses — Create a new analysis and kick off retrieval pipeline.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { smiles, target, disease } = req.body;

    if (!smiles || typeof smiles !== 'string') {
      return res.status(400).json({ error: 'SMILES string is required.' });
    }

    // Step 1: Create analysis record
    const analysis = await prisma.analysis.create({
      data: {
        smiles: smiles.trim(),
        target: target?.trim() || null,
        disease: disease?.trim() || null,
        status: 'pending',
      },
    });

    // Run the pipeline asynchronously so we can return immediately
    runPipeline(analysis.id, smiles.trim(), target?.trim() || null, disease?.trim() || null)
      .catch((err) => {
        console.error(`Pipeline error for analysis ${analysis.id}:`, err);
        prisma.analysis.update({
          where: { id: analysis.id },
          data: { status: 'error' },
        }).catch(console.error);
      });

    return res.status(201).json(analysis);
  } catch (error: any) {
    console.error('Create analysis error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/analyses — List all analyses (history).
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const analyses = await prisma.analysis.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { patents: true } },
      },
    });
    return res.json(analyses);
  } catch (error: any) {
    console.error('List analyses error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyses/:id — Get one analysis with its patents and explanations.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: req.params.id },
      include: {
        patents: {
          include: { aiExplanation: true },
          orderBy: { relevanceScore: 'desc' },
        },
        report: true,
      },
    });

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found.' });
    }

    return res.json(analysis);
  } catch (error: any) {
    console.error('Get analysis error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/analyses/:id/patents/:patentId — Flag/unflag/review a patent.
 */
router.patch('/:id/patents/:patentId', async (req: Request, res: Response) => {
  try {
    const { userFlagged, userReviewed } = req.body;

    const patent = await prisma.patent.findFirst({
      where: {
        id: req.params.patentId,
        analysisId: req.params.id,
      },
    });

    if (!patent) {
      return res.status(404).json({ error: 'Patent not found.' });
    }

    const updated = await prisma.patent.update({
      where: { id: req.params.patentId },
      data: {
        ...(typeof userFlagged === 'boolean' && { userFlagged }),
        ...(typeof userReviewed === 'boolean' && { userReviewed }),
      },
      include: { aiExplanation: true },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error('Update patent error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analyses/:id/report — Generate the final patentability report.
 */
router.post('/:id/report', async (req: Request, res: Response) => {
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: req.params.id },
      include: {
        patents: { include: { aiExplanation: true } },
      },
    });

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found.' });
    }

    // Check if report already exists
    const existingReport = await prisma.report.findUnique({
      where: { analysisId: analysis.id },
    });

    if (existingReport) {
      return res.json(existingReport);
    }

    // Compute rule-based recommendation
    const scoredPatents: ScoredPatent[] = analysis.patents.map((p: any) => ({
      patentNumber: p.patentNumber,
      title: p.title,
      abstract: p.abstract || '',
      publicationDate: p.publicationDate,
      assignee: p.assignee,
      source: p.source,
      relevanceScore: p.relevanceScore,
      retrievalMethod: p.retrievalMethod,
      estimatedExpiry: p.estimatedExpiry,
      isExpired: p.isExpired,
    }));

    const { recommendation, rationale } = computeRecommendation(scoredPatents);

    // Generate report via Groq
    const reportContent = await generateReport(
      analysis.smiles,
      analysis.compoundName,
      analysis.target,
      analysis.disease,
      analysis.patents.map((p: any) => ({
        patentNumber: p.patentNumber,
        title: p.title,
        abstract: p.abstract,
        assignee: p.assignee,
        publicationDate: p.publicationDate,
        relevanceScore: p.relevanceScore,
        retrievalMethod: p.retrievalMethod,
        isExpired: p.isExpired,
        estimatedExpiry: p.estimatedExpiry,
        userFlagged: p.userFlagged,
        aiExplanation: p.aiExplanation ? {
          reason: p.aiExplanation.reason,
          similarAspects: p.aiExplanation.similarAspects,
          overlap: p.aiExplanation.overlap,
          confidence: p.aiExplanation.confidence as 'low' | 'medium' | 'high',
          confidenceReason: p.aiExplanation.confidenceReason || '',
        } : null,
      })),
      recommendation,
      rationale
    );

    // Persist report
    const report = await prisma.report.create({
      data: {
        analysisId: analysis.id,
        ...reportContent,
      },
    });

    // Update analysis status and recommendation
    await prisma.analysis.update({
      where: { id: analysis.id },
      data: {
        status: 'completed',
        recommendation,
      },
    });

    return res.status(201).json(report);
  } catch (error: any) {
    console.error('Generate report error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyses/:id/report — Fetch existing report.
 */
router.get('/:id/report', async (req: Request, res: Response) => {
  try {
    const report = await prisma.report.findUnique({
      where: { analysisId: req.params.id },
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found. Generate it first.' });
    }

    return res.json(report);
  } catch (error: any) {
    console.error('Get report error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analyses/:id/report/pdf — Download report as PDF.
 */
router.get('/:id/report/pdf', async (req: Request, res: Response) => {
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: req.params.id },
      include: { report: true },
    });

    if (!analysis?.report) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const pdfBuffer = await generatePdf(analysis, analysis.report);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="PatentPilot_Report_${analysis.smiles.substring(0, 20)}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error: any) {
    console.error('PDF generation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * The main analysis pipeline — runs asynchronously after analysis creation.
 */
async function runPipeline(
  analysisId: string,
  smiles: string,
  target: string | null,
  disease: string | null
): Promise<void> {
  console.log(`[Pipeline] Starting for analysis ${analysisId}`);

  // Step 1: Validate & resolve SMILES via PubChem
  await prisma.analysis.update({
    where: { id: analysisId },
    data: { status: 'retrieving' },
  });

  const compound = await resolveSmiles(smiles);

  await prisma.analysis.update({
    where: { id: analysisId },
    data: {
      compoundName: compound.name,
      formula: compound.formula,
      molecularWeight: compound.molecularWeight ? parseFloat(compound.molecularWeight as string) : null,
      pubchemCid: compound.cid,
    },
  });

  console.log(`[Pipeline] Compound resolved: ${compound.name} (CID: ${compound.cid})`);

  // Step 2: Hybrid retrieval — run structural and keyword search in parallel
  const [structuralPatentIds, keywordResults] = await Promise.all([
    getPatentXrefs(compound.cid).catch((err) => {
      console.error('[Pipeline] Structural retrieval failed:', err.message);
      return [] as string[];
    }),
    buildKeywordQuery(compound.synonyms, target, disease)
      .then((terms) => searchPatents(terms))
      .catch((err) => {
        console.error('[Pipeline] Keyword retrieval failed:', err.message);
        return [];
      }),
  ]);

  console.log(
    `[Pipeline] Found ${structuralPatentIds.length} structural hits, ${keywordResults.length} keyword hits`
  );

  // Step 3: Enrich structural patents (PubChem only returns IDs, need metadata)
  const structuralEnriched = await Promise.all(
    structuralPatentIds.slice(0, 20).map((id) =>
      enrichPatent(id).catch((err) => {
        console.error(`[Pipeline] Enrichment failed for ${id}:`, err.message);
        return {
          patentNumber: id,
          title: 'Enrichment failed',
          abstract: '',
          publicationDate: null,
          assignee: null,
        };
      })
    )
  );

  // Step 4: Score and merge
  const queryTerms = buildQueryTermsForScoring(compound.synonyms, compound.name, target, disease);

  const structuralScored = structuralEnriched.map((p) => scoreStructuralHit(p));
  const keywordScored = keywordResults.map((p) => scoreKeywordHit(p, queryTerms));
  const merged = mergeAndDeduplicate(structuralScored, keywordScored);

  console.log(`[Pipeline] ${merged.length} deduplicated patents after merge`);

  // Step 5: Persist patents
  for (const patent of merged) {
    await prisma.patent.upsert({
      where: {
        analysisId_patentNumber: {
          analysisId,
          patentNumber: patent.patentNumber,
        },
      },
      create: {
        analysisId,
        patentNumber: patent.patentNumber,
        title: patent.title,
        publicationDate: patent.publicationDate,
        assignee: patent.assignee,
        abstract: patent.abstract,
        source: patent.source,
        relevanceScore: patent.relevanceScore,
        retrievalMethod: patent.retrievalMethod,
        estimatedExpiry: patent.estimatedExpiry,
        isExpired: patent.isExpired,
      },
      update: {
        title: patent.title,
        publicationDate: patent.publicationDate,
        assignee: patent.assignee,
        abstract: patent.abstract,
        source: patent.source,
        relevanceScore: patent.relevanceScore,
        retrievalMethod: patent.retrievalMethod,
        estimatedExpiry: patent.estimatedExpiry,
        isExpired: patent.isExpired,
      },
    });
  }

  // Step 6: AI explanations for each patent
  await prisma.analysis.update({
    where: { id: analysisId },
    data: { status: 'analyzing' },
  });

  const persistedPatents = await prisma.patent.findMany({
    where: { analysisId },
    orderBy: { relevanceScore: 'desc' },
  });

  const patentsToExplain = persistedPatents.slice(0, 15);
  for (const patent of patentsToExplain) {
    try {
      const explanation = await explainPatent(smiles, target, disease, {
        patentNumber: patent.patentNumber,
        title: patent.title,
        abstract: patent.abstract,
        assignee: patent.assignee,
        publicationDate: patent.publicationDate,
        relevanceScore: patent.relevanceScore,
        retrievalMethod: patent.retrievalMethod,
        isExpired: patent.isExpired,
        estimatedExpiry: patent.estimatedExpiry,
        userFlagged: patent.userFlagged,
      });

      await prisma.aiExplanation.upsert({
        where: { patentId: patent.id },
        create: {
          patentId: patent.id,
          reason: explanation.reason,
          similarAspects: explanation.similarAspects,
          overlap: explanation.overlap,
          confidence: explanation.confidence,
          confidenceReason: explanation.confidenceReason,
        },
        update: {
          reason: explanation.reason,
          similarAspects: explanation.similarAspects,
          overlap: explanation.overlap,
          confidence: explanation.confidence,
          confidenceReason: explanation.confidenceReason,
        },
      });
    } catch (err: any) {
      console.error(`[Pipeline] AI explanation failed for ${patent.patentNumber}:`, err.message);
    }
  }

  // Step 7: Update status to in_review (ready for user to review and generate report)
  const { recommendation } = computeRecommendation(merged);

  await prisma.analysis.update({
    where: { id: analysisId },
    data: {
      status: 'in_review',
      recommendation,
    },
  });

  console.log(`[Pipeline] Analysis ${analysisId} complete. Recommendation: ${recommendation}`);
}

/**
 * Build keyword query terms from compound data and user inputs.
 */
async function buildKeywordQuery(
  synonyms: string[],
  target: string | null,
  disease: string | null
): Promise<string[]> {
  const terms: string[] = [];

  // Use top synonyms (shorter, more searchable ones)
  const usableSynonyms = synonyms
    .filter((s) => s.length < 50 && !s.match(/^\d+$/)) // Skip CAS-like numbers and very long names
    .slice(0, 3);
  terms.push(...usableSynonyms);

  if (target) terms.push(target);
  if (disease) terms.push(disease);

  // Always add "patent" context
  terms.push('pharmaceutical');

  return terms;
}

/**
 * Build query terms for keyword scoring.
 */
function buildQueryTermsForScoring(
  synonyms: string[],
  compoundName: string,
  target: string | null,
  disease: string | null
): string[] {
  const terms: string[] = [compoundName];
  terms.push(...synonyms.slice(0, 5));
  if (target) terms.push(target);
  if (disease) terms.push(disease);
  return terms.filter(Boolean);
}

export default router;
