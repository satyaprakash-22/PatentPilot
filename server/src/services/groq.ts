import Groq from 'groq-sdk';
import { getCached, setCache } from './llmCache';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
const GROQ_MODEL = 'openai/gpt-oss-120b';

export interface PatentExplanation {
  reason: string;
  similarAspects: string;
  overlap: string;
  confidence: 'low' | 'medium' | 'high';
  confidenceReason: string;
}

export interface ReportContent {
  executiveSummary: string;
  keySimilarPatents: string;
  noveltyConcerns: string;
  manualReviewList: string;
  recommendation: string;
  rationale: string;
}

interface PatentForAnalysis {
  patentNumber: string;
  title: string;
  abstract: string | null;
  assignee: string | null;
  publicationDate: Date | null;
  relevanceScore: number;
  retrievalMethod: string;
  isExpired: boolean;
  estimatedExpiry: Date | null;
  userFlagged: boolean;
}

/**
 * Generate a grounded AI explanation for why a specific patent is relevant
 * to the submitted molecule. Per PRD Section 4.4.
 */
export async function explainPatent(
  smiles: string,
  target: string | null,
  disease: string | null,
  patent: PatentForAnalysis
): Promise<PatentExplanation> {
  // Check cache first
  const cached = await getCached(smiles, patent.patentNumber, 'patent_explanation');
  if (cached) {
    return cached as PatentExplanation;
  }

  const prompt = buildPatentExplanationPrompt(smiles, target, disease, patent);

  try {
    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const text = response.choices[0]?.message?.content || '';
    const parsed = JSON.parse(text) as PatentExplanation;

    // Validate structure
    const explanation: PatentExplanation = {
      reason: parsed.reason || 'Analysis could not determine retrieval reason.',
      similarAspects: parsed.similarAspects || 'No specific similar aspects identified.',
      overlap: parsed.overlap || 'No overlap analysis available.',
      confidence: (['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'low') as 'low' | 'medium' | 'high',
      confidenceReason: parsed.confidenceReason || 'Confidence could not be determined.',
    };

    // Cache the result
    await setCache(smiles, patent.patentNumber, 'patent_explanation', explanation);

    return explanation;
  } catch (error: any) {
    const isModelDeprecated = error.status === 404 || String(error.status) === 'NOT_FOUND' || (error.message && error.message.includes('404'));
    if (isModelDeprecated) {
      console.error(`Model deprecation error for ${patent.patentNumber}: The requested Groq model is no longer available.`, error.message);
    } else {
      console.error(`Groq explanation error for ${patent.patentNumber}:`, error.message);
    }

    const errorMessage = isModelDeprecated 
      ? 'AI analysis failed: Model deprecated or unavailable (404).'
      : `AI analysis could not be completed: ${error.message}`;

    // Return a structured error response — never mock
    return {
      reason: errorMessage,
      similarAspects: 'Analysis unavailable due to API error.',
      overlap: 'Analysis unavailable due to API error.',
      confidence: 'low',
      confidenceReason: 'AI analysis failed — manual review required.',
    };
  }
}

/**
 * Generate the final patentability report by synthesizing all patent
 * explanations and scores. Per PRD Section 4.5.
 */
export async function generateReport(
  smiles: string,
  compoundName: string | null,
  target: string | null,
  disease: string | null,
  patents: (PatentForAnalysis & { aiExplanation?: PatentExplanation | null })[],
  ruleBasedRecommendation: string,
  ruleBasedRationale: string
): Promise<ReportContent> {
  // Use a combined cache key for the report
  const patentSummary = patents.map((p) => p.patentNumber).sort().join(',');
  const cached = await getCached(smiles, `report:${patentSummary}`, 'report_synthesis');
  if (cached) {
    return cached as ReportContent;
  }

  const prompt = buildReportPrompt(
    smiles, compoundName, target, disease,
    patents, ruleBasedRecommendation, ruleBasedRationale
  );

  try {
    let attempt = 0;
    const maxAttempts = 3;
    let response;

    while (attempt < maxAttempts) {
      try {
        response = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });
        break; // Success
      } catch (err: any) {
        attempt++;
        if (attempt >= maxAttempts) throw err;

        // Check for 429 Rate Limit
        if (err.status === 429 || (err.message && err.message.includes('429'))) {
          let delayMs = 60000;
          try {
            if (err.headers && err.headers['retry-after']) {
               const delay = parseFloat(err.headers['retry-after']);
               if (!isNaN(delay)) delayMs = delay * 1000;
            } else {
               const match = err.message.match(/retryDelay["']?\s*:\s*["']?(\d+)s["']?/);
               if (match && match[1]) {
                 delayMs = parseInt(match[1], 10) * 1000;
               }
            }
          } catch (e) {}
          
          console.warn(`[GenerateReport] Rate limit hit. Retrying in ${delayMs / 1000}s (Attempt ${attempt}/${maxAttempts})...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          throw err;
        }
      }
    }

    const text = response?.choices[0]?.message?.content || '';
    const parsed = JSON.parse(text) as ReportContent;

    const report: ReportContent = {
      executiveSummary: parsed.executiveSummary || 'Report generation incomplete.',
      keySimilarPatents: parsed.keySimilarPatents || 'No key patents identified.',
      noveltyConcerns: parsed.noveltyConcerns || 'No novelty concerns identified.',
      manualReviewList: parsed.manualReviewList || 'No patents flagged for manual review.',
      recommendation: ruleBasedRecommendation, // Always use rule-based, not LLM's opinion
      rationale: parsed.rationale || ruleBasedRationale,
    };

    await setCache(smiles, `report:${patentSummary}`, 'report_synthesis', report);
    return report;
  } catch (error: any) {
    const isModelDeprecated = error.status === 404 || String(error.status) === 'NOT_FOUND' || (error.message && error.message.includes('404'));
    if (isModelDeprecated) {
      console.error('Model deprecation error during report generation: The requested Groq model is no longer available.', error.message);
    } else {
      console.error('Groq report generation error:', error.message);
    }

    const errorMessage = isModelDeprecated
      ? 'Automated report generation failed (Model deprecated or unavailable - 404). Rule-based analysis is provided below.'
      : `Automated report generation failed (${error.message}). Rule-based analysis is provided below.`;

    // Return rule-based results without AI synthesis
    return {
      executiveSummary: errorMessage,
      keySimilarPatents: patents
        .filter((p) => p.relevanceScore >= 60)
        .map((p) => `${p.patentNumber}: ${p.title} (Score: ${p.relevanceScore})`)
        .join('\n') || 'None identified.',
      noveltyConcerns: 'AI synthesis unavailable — please review individual patent analyses.',
      manualReviewList: patents
        .filter((p) => p.userFlagged || p.aiExplanation?.confidence === 'low')
        .map((p) => `${p.patentNumber}: ${p.title}`)
        .join('\n') || 'None flagged.',
      recommendation: ruleBasedRecommendation,
      rationale: ruleBasedRationale,
    };
  }
}

function buildPatentExplanationPrompt(
  smiles: string,
  target: string | null,
  disease: string | null,
  patent: PatentForAnalysis
): string {
  return `You are a patent analysis assistant. Your task is to analyze why a specific patent may be relevant to a molecule being researched for freedom-to-operate assessment.

MOLECULE INFORMATION:
- SMILES: ${smiles}
${target ? `- Therapeutic target: ${target}` : ''}
${disease ? `- Disease/indication: ${disease}` : ''}

PATENT INFORMATION:
- Patent number: ${patent.patentNumber}
- Title: ${patent.title}
- Assignee: ${patent.assignee || 'Unknown'}
- Publication date: ${patent.publicationDate ? new Date(patent.publicationDate).toISOString().split('T')[0] : 'Unknown'}
- How it was found: ${patent.retrievalMethod === 'structural' ? 'Exact structural match (PubChem CID cross-reference)' : patent.retrievalMethod === 'keyword' ? 'Keyword search match' : 'Both structural and keyword match'}
- Abstract: ${patent.abstract || 'No abstract available'}

INSTRUCTIONS:
1. You MUST base your analysis ONLY on the information provided above. Do NOT use any external knowledge about this patent.
2. Reference SPECIFIC details from the patent title and abstract in your analysis.
3. Do NOT use generic boilerplate language. Every statement must be tied to a specific detail from the provided text.
4. If the abstract is unavailable or too vague, clearly state that and set confidence to "low".

Respond with ONLY a JSON object in this exact format:
{
  "reason": "Why this patent was retrieved and why it might be relevant to the molecule — reference specific details from the abstract",
  "similarAspects": "Which aspects appear similar (structural, therapeutic target, mechanism, etc.) — cite specific text from the abstract",
  "overlap": "What possible overlap exists between this patent's claims and the molecule — be specific",
  "confidence": "low" | "medium" | "high",
  "confidenceReason": "One-line justification for the confidence level, referencing concrete evidence or lack thereof"
}`;
}

function buildReportPrompt(
  smiles: string,
  compoundName: string | null,
  target: string | null,
  disease: string | null,
  patents: (PatentForAnalysis & { aiExplanation?: PatentExplanation | null })[],
  ruleBasedRecommendation: string,
  ruleBasedRationale: string
): string {
  const patentSummaries = patents.map((p, i) => {
    const expl = p.aiExplanation;
    return `Patent ${i + 1}: ${p.patentNumber}
  Title: ${p.title}
  Relevance Score: ${p.relevanceScore}
  Retrieval Method: ${p.retrievalMethod}
  Expired: ${p.isExpired ? 'Yes (estimated)' : 'No'}
  User Flagged: ${p.userFlagged ? 'Yes' : 'No'}
  AI Confidence: ${expl?.confidence || 'N/A'}
  AI Reason: ${expl?.reason || 'N/A'}
  Overlap: ${expl?.overlap || 'N/A'}`;
  }).join('\n\n');

  const flaggedPatents = patents.filter((p) => p.userFlagged || p.aiExplanation?.confidence === 'low');

  return `You are a patent analysis assistant generating a Freedom-to-Operate (FTO) patentability report.

MOLECULE:
- SMILES: ${smiles}
- Compound name: ${compoundName || 'Unknown'}
${target ? `- Target: ${target}` : ''}
${disease ? `- Disease: ${disease}` : ''}

RULE-BASED RECOMMENDATION: ${ruleBasedRecommendation.replace('_', ' ').toUpperCase()}
RULE-BASED RATIONALE: ${ruleBasedRationale}

RETRIEVED PATENTS (${patents.length} total):
${patentSummaries}

FLAGGED FOR MANUAL REVIEW (${flaggedPatents.length}):
${flaggedPatents.map((p) => `- ${p.patentNumber}: ${p.title}`).join('\n') || 'None'}

INSTRUCTIONS:
1. Synthesize the above data into a structured report. Ground every statement in the specific patent data above.
2. The recommendation MUST match the rule-based recommendation: "${ruleBasedRecommendation}". Do not override it.
3. Do NOT use generic boilerplate. Reference specific patent numbers and details.
4. The report should be useful to a researcher deciding whether to proceed with this molecule.

Respond with ONLY a JSON object:
{
  "executiveSummary": "2-3 paragraph executive summary covering the molecule, retrieval results, and key findings",
  "keySimilarPatents": "Detailed analysis of the top 3-5 most relevant patents with specific reasons",
  "noveltyConcerns": "Specific areas where novelty may be challenged, citing patent numbers",
  "manualReviewList": "List of patents requiring expert manual review with reasons (include all user-flagged and low-confidence patents)",
  "recommendation": "${ruleBasedRecommendation}",
  "rationale": "Detailed explanation of why this recommendation was reached, showing the scoring logic transparently"
}`;
}
