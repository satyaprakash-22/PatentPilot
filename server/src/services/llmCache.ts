import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const PROMPT_VERSION = 'v1';

/**
 * Generate a cache key from the input parameters.
 * Key = hash(molecule + patentNumber + promptVersion)
 */
function generateCacheKey(molecule: string, patentNumber: string, promptType: string): string {
  const input = `${molecule}|${patentNumber}|${promptType}|${PROMPT_VERSION}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Check if a cached response exists for the given parameters.
 */
export async function getCached(
  molecule: string,
  patentNumber: string,
  promptType: string
): Promise<any | null> {
  const cacheKey = generateCacheKey(molecule, patentNumber, promptType);

  try {
    const cached = await prisma.llmCache.findUnique({
      where: { cacheKey },
    });

    if (cached) {
      console.log(`[LLM Cache] HIT for ${promptType}: ${patentNumber}`);
      return cached.response;
    }

    console.log(`[LLM Cache] MISS for ${promptType}: ${patentNumber}`);
    return null;
  } catch (error) {
    console.error('[LLM Cache] Read error:', error);
    return null;
  }
}

/**
 * Store a response in the cache.
 */
export async function setCache(
  molecule: string,
  patentNumber: string,
  promptType: string,
  response: any
): Promise<void> {
  const cacheKey = generateCacheKey(molecule, patentNumber, promptType);

  try {
    await prisma.llmCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        response,
      },
      update: {
        response,
      },
    });
    console.log(`[LLM Cache] STORED for ${promptType}: ${patentNumber}`);
  } catch (error) {
    console.error('[LLM Cache] Write error:', error);
  }
}
