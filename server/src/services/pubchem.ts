import fetch from 'node-fetch';

interface PubChemCompound {
  cid: number;
  name: string;
  formula: string;
  molecularWeight: number;
  synonyms: string[];
  imageUrl: string;
}

interface PubChemPropertyResponse {
  PropertyTable?: {
    Properties?: Array<{
      CID: number;
      MolecularFormula?: string;
      MolecularWeight?: number;
      IUPACName?: string;
      Title?: string;
    }>;
  };
}

interface PubChemSynonymsResponse {
  InformationList?: {
    Information?: Array<{
      CID: number;
      Synonym?: string[];
    }>;
  };
}

interface PubChemXrefsResponse {
  InformationList?: {
    Information?: Array<{
      CID: number;
      PatentID?: string[];
    }>;
  };
}

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

/**
 * Validate SMILES and resolve compound metadata via PubChem PUG REST API.
 */
export async function resolveSmiles(smiles: string): Promise<PubChemCompound> {
  const encodedSmiles = encodeURIComponent(smiles);

  // Step 1: Get CID from SMILES
  const cidUrl = `${PUBCHEM_BASE}/compound/smiles/${encodedSmiles}/cids/JSON`;
  const cidRes = await fetch(cidUrl);
  if (!cidRes.ok) {
    const text = await cidRes.text();
    if (cidRes.status === 404 || text.includes('PUGREST.NotFound')) {
      throw new Error('SMILES not recognized by PubChem. Please check the structure and try again.');
    }
    throw new Error(`PubChem lookup failed (${cidRes.status}): ${text}`);
  }

  const cidData = (await cidRes.json()) as { IdentifierList?: { CID?: number[] } };
  const cid = cidData?.IdentifierList?.CID?.[0];
  if (!cid) {
    throw new Error('Could not resolve SMILES to a PubChem compound ID.');
  }

  // Step 2: Get properties (formula, weight, name)
  const propsUrl = `${PUBCHEM_BASE}/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName,Title/JSON`;
  const propsRes = await fetch(propsUrl);
  let formula = '';
  let molecularWeight = 0;
  let name = '';

  if (propsRes.ok) {
    const propsData = (await propsRes.json()) as PubChemPropertyResponse;
    const props = propsData?.PropertyTable?.Properties?.[0];
    if (props) {
      formula = props.MolecularFormula || '';
      molecularWeight = props.MolecularWeight || 0;
      name = props.Title || props.IUPACName || '';
    }
  }

  // Step 3: Get synonyms (used for keyword search)
  const synUrl = `${PUBCHEM_BASE}/compound/cid/${cid}/synonyms/JSON`;
  const synRes = await fetch(synUrl);
  let synonyms: string[] = [];

  if (synRes.ok) {
    const synData = (await synRes.json()) as PubChemSynonymsResponse;
    const synInfo = synData?.InformationList?.Information?.[0];
    if (synInfo?.Synonym) {
      // Take first 10 synonyms to keep keyword queries manageable
      synonyms = synInfo.Synonym.slice(0, 10);
    }
  }

  // If no name from properties, use first synonym
  if (!name && synonyms.length > 0) {
    name = synonyms[0];
  }

  const imageUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG`;

  return {
    cid,
    name: name || `CID-${cid}`,
    formula,
    molecularWeight,
    synonyms,
    imageUrl,
  };
}

/**
 * Get patent cross-references for a PubChem CID.
 * Returns patent IDs that directly reference this exact compound.
 */
export async function getPatentXrefs(cid: number): Promise<string[]> {
  const url = `${PUBCHEM_BASE}/compound/cid/${cid}/xrefs/PatentID/JSON`;
  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) {
      // No patent cross-references found — this is a valid result, not an error
      return [];
    }
    const text = await res.text();
    throw new Error(`PubChem patent xrefs failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as PubChemXrefsResponse;
  const patents = data?.InformationList?.Information?.[0]?.PatentID || [];

  // Return unique patent IDs, limited to a reasonable number
  const unique = [...new Set(patents)];
  return unique.slice(0, 50); // Cap at 50 to keep processing manageable
}
