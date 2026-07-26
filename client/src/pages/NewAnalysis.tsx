import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAnalysis } from '../services/api';

interface CompoundPreview {
  name: string;
  formula: string;
  molecularWeight: number;
  imageUrl: string;
  cid: number;
}

export default function NewAnalysis() {
  const navigate = useNavigate();
  const [smiles, setSmiles] = useState('');
  const [target, setTarget] = useState('');
  const [disease, setDisease] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [compound, setCompound] = useState<CompoundPreview | null>(null);

  const validateSmiles = async () => {
    if (!smiles.trim()) return;
    setValidating(true);
    setError('');
    setCompound(null);

    try {
      const encoded = encodeURIComponent(smiles.trim());
      const cidRes = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encoded}/cids/JSON`
      );

      if (!cidRes.ok) {
        setError('SMILES not recognized by PubChem. Please check the structure.');
        setValidating(false);
        return;
      }

      const cidData = await cidRes.json();
      const cid = cidData?.IdentifierList?.CID?.[0];
      if (!cid) {
        setError('Could not resolve SMILES to a compound.');
        setValidating(false);
        return;
      }

      const propsRes = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,Title/JSON`
      );

      let name = `CID-${cid}`;
      let formula = '';
      let molecularWeight = 0;

      if (propsRes.ok) {
        const propsData = await propsRes.json();
        const props = propsData?.PropertyTable?.Properties?.[0];
        if (props) {
          name = props.Title || props.IUPACName || name;
          formula = props.MolecularFormula || '';
          molecularWeight = props.MolecularWeight || 0;
        }
      }

      setCompound({
        cid,
        name,
        formula,
        molecularWeight,
        imageUrl: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG`,
      });
    } catch (err: any) {
      setError('Failed to validate SMILES. Check your connection and try again.');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!smiles.trim()) {
      setError('SMILES string is required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const analysis = await createAnalysis({
        smiles: smiles.trim(),
        target: target.trim() || undefined,
        disease: disease.trim() || undefined,
      });
      navigate(`/analysis/${analysis.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create analysis.');
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New FTO Analysis</h1>
        <p className="page-subtitle">
          Submit a molecule to check for potential patent conflicts
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: 600 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="smiles">
            SMILES String *
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="smiles"
              type="text"
              className="form-input mono"
              placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
              value={smiles}
              onChange={(e) => {
                setSmiles(e.target.value);
                setCompound(null);
                setError('');
              }}
              required
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={validateSmiles}
              disabled={!smiles.trim() || validating}
            >
              {validating ? 'Checking…' : 'Validate'}
            </button>
          </div>
          <p className="form-hint">
            Enter a valid SMILES string. Click Validate to confirm the compound is recognized by PubChem.
          </p>
          {error && <p className="form-error">{error}</p>}
        </div>

        {compound && (
          <div className="compound-card">
            <img
              src={compound.imageUrl}
              alt={compound.name}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="compound-info">
              <div className="compound-name">{compound.name}</div>
              <div className="compound-detail">
                <span>Formula:</span> <code>{compound.formula}</code>
              </div>
              <div className="compound-detail">
                <span>Molecular Weight:</span> {compound.molecularWeight.toFixed(2)} g/mol
              </div>
              <div className="compound-detail">
                <span>PubChem CID:</span> <code>{compound.cid}</code>
              </div>
              <div className="compound-detail" style={{ marginTop: 8 }}>
                <span className="badge badge-risk-low">✓ Compound recognized</span>
              </div>
            </div>
          </div>
        )}

        <div className="form-group" style={{ marginTop: 20 }}>
          <label className="form-label" htmlFor="target">
            Therapeutic Target (optional)
          </label>
          <input
            id="target"
            type="text"
            className="form-input"
            placeholder="e.g. COX-2, EGFR, ACE2"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <p className="form-hint">
            Specifying a target improves keyword-based patent discovery
          </p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="disease">
            Disease / Indication (optional)
          </label>
          <input
            id="disease"
            type="text"
            className="form-input"
            placeholder="e.g. Rheumatoid arthritis, Non-small cell lung cancer"
            value={disease}
            onChange={(e) => setDisease(e.target.value)}
          />
          <p className="form-hint">
            Additional context for broadening keyword patent search
          </p>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !smiles.trim()}
        >
          {loading ? 'Starting Analysis…' : 'Run FTO Analysis'}
        </button>
      </form>
    </div>
  );
}
