import fetch from 'node-fetch';

export interface GooglePatentResult {
  patentNumber: string;
  title: string;
  abstract: string;
  publicationDate: string | null;
  assignee: string | null;
}

/**
 * Search Google Patents public search endpoint for keyword-based patent discovery.
 * Uses the public xhr/query endpoint (no API key required).
 */
export async function searchPatents(queryTerms: string[]): Promise<GooglePatentResult[]> {
  const query = queryTerms.filter(Boolean).join(' ');
  if (!query.trim()) return [];

  try {
    const url = `https://patents.google.com/xhr/query?url=q%3D${encodeURIComponent(query)}%26num%3D20&exp=`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      console.error(`Google Patents search failed (${res.status})`);
      throw new Error(`Google Patents search failed with status ${res.status}. Keyword patent retrieval is unavailable.`);
    }

    const data = await res.json() as any;

    // Parse the response structure
    const results: GooglePatentResult[] = [];
    const clusters = data?.results?.cluster || [];

    for (const cluster of clusters) {
      const docs = cluster?.result || [];
      for (const doc of docs) {
        const patent = doc?.patent;
        if (!patent) continue;

        const patentNumber = patent.publication_number?.replace(/[-\s]/g, '') || '';
        if (!patentNumber) continue;

        results.push({
          patentNumber,
          title: patent.title || 'Untitled',
          abstract: patent.snippet || patent.abstract || '',
          publicationDate: patent.publication_date || null,
          assignee: patent.assignee || null,
        });
      }
    }

    return results.slice(0, 20);
  } catch (error: any) {
    if (error.message?.includes('Google Patents search failed')) {
      throw error;
    }
    console.error('Google Patents search error:', error.message);
    throw new Error(`Google Patents keyword search failed: ${error.message}`);
  }
}

/**
 * Enrich a patent by its number via Google Patents page fetch.
 * Used to fill in metadata for patents found via PubChem xrefs (which only return IDs).
 */
export async function enrichPatent(patentNumber: string): Promise<GooglePatentResult> {
  const cleanNumber = patentNumber.replace(/[-\s]/g, '');

  try {
    const url = `https://patents.google.com/patent/${cleanNumber}/en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    if (!res.ok) {
      console.error(`Google Patents enrichment failed for ${cleanNumber} (${res.status})`);
      return {
        patentNumber: cleanNumber,
        title: 'Title unavailable',
        abstract: '',
        publicationDate: null,
        assignee: null,
      };
    }

    const html = await res.text();

    // Parse title from meta tags or title element
    const titleMatch = html.match(/<meta\s+name="DC\.title"\s+content="([^"]*)"/) ||
                        html.match(/<title>([^<]*)<\/title>/);
    const title = titleMatch?.[1]?.replace(/ - Google Patents$/, '').trim() || 'Title unavailable';

    // Parse abstract
    const abstractMatch = html.match(/<meta\s+name="DC\.description"\s+content="([^"]*)"/) ||
                           html.match(/<div class="abstract"[^>]*>([\s\S]*?)<\/div>/);
    let abstract = abstractMatch?.[1] || '';
    abstract = abstract.replace(/<[^>]*>/g, '').trim();

    // Parse publication date
    const dateMatch = html.match(/<meta\s+name="DC\.date"\s+content="([^"]*)"/) ||
                      html.match(/Publication date<\/td>\s*<td[^>]*>([^<]*)<\/td>/);
    const publicationDate = dateMatch?.[1] || null;

    // Parse assignee
    const assigneeMatch = html.match(/Assignee<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/) ||
                           html.match(/<meta\s+name="DC\.contributor"\s+content="([^"]*)"/) ||
                           html.match(/<dd itemprop="assigneeOriginal"[^>]*>([^<]*)<\/dd>/);
    let assignee = assigneeMatch?.[1] || null;
    if (assignee) {
      assignee = assignee.replace(/<[^>]*>/g, '').trim();
    }

    return {
      patentNumber: cleanNumber,
      title,
      abstract: abstract.substring(0, 2000), // Cap abstract length
      publicationDate,
      assignee,
    };
  } catch (error: any) {
    console.error(`Google Patents enrichment error for ${cleanNumber}:`, error.message);
    return {
      patentNumber: cleanNumber,
      title: 'Title unavailable (enrichment failed)',
      abstract: '',
      publicationDate: null,
      assignee: null,
    };
  }
}
