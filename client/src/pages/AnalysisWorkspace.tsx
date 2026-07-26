import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAnalysis, updatePatent, generateReport } from '../services/api';
import { Analysis, Patent } from '../types';

type SortOption = 'relevance' | 'date';
type FilterOption = 'all' | 'structural' | 'keyword' | 'both';

export default function AnalysisWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedPatent, setSelectedPatent] = useState<Patent | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [filterBy, setFilterBy] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);

  const fetchAnalysis = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getAnalysis(id);
      setAnalysis(data);
      if (data.patents && data.patents.length > 0 && !selectedPatent) {
        setSelectedPatent(data.patents[0]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  // Poll while analysis is still processing
  useEffect(() => {
    if (!analysis) return;
    if (['pending', 'retrieving', 'analyzing'].includes(analysis.status)) {
      const interval = setInterval(fetchAnalysis, 3000);
      return () => clearInterval(interval);
    }
  }, [analysis?.status, fetchAnalysis]);

  const handleFlag = async (patent: Patent) => {
    if (!id) return;
    try {
      const updated = await updatePatent(id, patent.id, {
        userFlagged: !patent.userFlagged,
      });
      setAnalysis((prev) => {
        if (!prev || !prev.patents) return prev;
        return {
          ...prev,
          patents: prev.patents.map((p) => (p.id === updated.id ? updated : p)),
        };
      });
      if (selectedPatent?.id === updated.id) {
        setSelectedPatent(updated);
      }
    } catch (err: any) {
      console.error('Flag error:', err);
    }
  };

  const handleReviewed = async (patent: Patent) => {
    if (!id) return;
    try {
      const updated = await updatePatent(id, patent.id, {
        userReviewed: !patent.userReviewed,
      });
      setAnalysis((prev) => {
        if (!prev || !prev.patents) return prev;
        return {
          ...prev,
          patents: prev.patents.map((p) => (p.id === updated.id ? updated : p)),
        };
      });
      if (selectedPatent?.id === updated.id) {
        setSelectedPatent(updated);
      }
    } catch (err: any) {
      console.error('Review error:', err);
    }
  };

  const handleGenerateReport = async () => {
    if (!id) return;
    setGeneratingReport(true);
    try {
      await generateReport(id);
      navigate(`/analysis/${id}/report`);
    } catch (err: any) {
      setError(err.message);
      setGeneratingReport(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div className="skeleton skeleton-text" style={{ width: 200, height: 20 }} />
          <div className="skeleton skeleton-text short" style={{ marginTop: 8, height: 14 }} />
        </div>
        <div className="workspace-layout">
          <div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚠</div>
        <div className="empty-state-text">{error}</div>
        <button className="btn btn-primary" onClick={() => navigate('/new')}>
          Start New Analysis
        </button>
      </div>
    );
  }

  if (!analysis) return null;

  const isProcessing = ['pending', 'retrieving', 'analyzing'].includes(analysis.status);
  const patents = analysis.patents || [];

  // Filter
  const filtered = patents.filter((p) => {
    if (filterBy === 'all') return true;
    return p.retrievalMethod === filterBy;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'relevance') return b.relevanceScore - a.relevanceScore;
    const dateA = a.publicationDate ? new Date(a.publicationDate).getTime() : 0;
    const dateB = b.publicationDate ? new Date(b.publicationDate).getTime() : 0;
    return dateB - dateA;
  });

  const getScoreClass = (score: number) => {
    if (score >= 80) return 'score-high';
    if (score >= 50) return 'score-medium';
    return 'score-low';
  };

  const getMethodBadge = (method: string) => {
    switch (method) {
      case 'structural':
        return <span className="badge badge-structural">🧬 Structural</span>;
      case 'keyword':
        return <span className="badge badge-keyword">🔤 Keyword</span>;
      case 'both':
        return <span className="badge badge-both">🧬🔤 Both</span>;
      default:
        return null;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Initializing…';
      case 'retrieving': return 'Retrieving patents…';
      case 'analyzing': return 'Running AI analysis…';
      case 'in_review': return 'Ready for review';
      case 'completed': return 'Completed';
      case 'error': return 'Error occurred';
      default: return status;
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">
          FTO Analysis {analysis.compoundName ? `— ${analysis.compoundName}` : ''}
        </h1>
        <p className="page-subtitle">
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            {analysis.smiles}
          </code>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <div className="status-indicator">
            <span className={`status-dot ${analysis.status}`} />
            {getStatusLabel(analysis.status)}
          </div>
          {analysis.recommendation && (
            <span
              className={`badge badge-risk-${
                analysis.recommendation === 'low_risk'
                  ? 'low'
                  : analysis.recommendation === 'high_risk'
                  ? 'high'
                  : 'medium'
              }`}
            >
              {analysis.recommendation === 'low_risk'
                ? 'Low Risk'
                : analysis.recommendation === 'high_risk'
                ? 'High Risk'
                : 'Expert Review'}
            </span>
          )}
        </div>
      </div>

      {/* Compound info bar */}
      {analysis.compoundName && (
        <div className="compound-card" style={{ marginBottom: 20, marginTop: 0 }}>
          {analysis.pubchemCid && (
            <img
              src={`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${analysis.pubchemCid}/PNG`}
              alt={analysis.compoundName}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="compound-info">
            <div className="compound-name">{analysis.compoundName}</div>
            {analysis.formula && (
              <div className="compound-detail">
                <span>Formula:</span> <code>{analysis.formula}</code>
              </div>
            )}
            {analysis.molecularWeight && (
              <div className="compound-detail">
                <span>MW:</span> {analysis.molecularWeight.toFixed(2)} g/mol
              </div>
            )}
            {analysis.target && (
              <div className="compound-detail">
                <span>Target:</span> {analysis.target}
              </div>
            )}
            {analysis.disease && (
              <div className="compound-detail">
                <span>Disease:</span> {analysis.disease}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Processing state */}
      {isProcessing && (
        <div style={{ marginBottom: 20 }}>
          <div className="card">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {analysis.status === 'pending' && 'Validating molecule and preparing retrieval…'}
              {analysis.status === 'retrieving' && 'Searching PubChem structural cross-references and Google Patents keyword results…'}
              {analysis.status === 'analyzing' && 'Generating AI explanations for each retrieved patent. This may take a minute…'}
            </p>
            {patents.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
                {patents.length} patent(s) found so far
              </p>
            )}
          </div>
        </div>
      )}

      {/* Toolbar */}
      {patents.length > 0 && (
        <div className="toolbar">
          <div className="toolbar-group">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              {sorted.length} of {patents.length} patents
            </span>
          </div>
          <div className="toolbar-group">
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="relevance">Relevance</option>
              <option value="date">Date</option>
            </select>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
              Filter:
            </label>
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterOption)}
            >
              <option value="all">All Methods</option>
              <option value="structural">Structural Only</option>
              <option value="keyword">Keyword Only</option>
              <option value="both">Both Methods</option>
            </select>
          </div>
          <div className="toolbar-group">
            {analysis.report ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate(`/analysis/${id}/report`)}
              >
                View Report
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleGenerateReport}
                disabled={isProcessing || generatingReport}
              >
                {generatingReport ? 'Generating…' : 'Generate Report'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main workspace */}
      {patents.length > 0 ? (
        <div className="workspace-layout">
          {/* Patent list */}
          <div className="patent-list">
            {sorted.map((patent) => (
              <div
                key={patent.id}
                className={`patent-card${
                  selectedPatent?.id === patent.id ? ' selected' : ''
                }${patent.userFlagged ? ' flagged' : ''}`}
                onClick={() => setSelectedPatent(patent)}
              >
                <div className="patent-card-header">
                  <div style={{ flex: 1 }}>
                    <div className="patent-card-number">{patent.patentNumber}</div>
                    <div className="patent-card-title">{patent.title}</div>
                  </div>
                  <span className={`score-badge ${getScoreClass(patent.relevanceScore)}`}>
                    {Math.round(patent.relevanceScore)}
                  </span>
                </div>
                {patent.abstract && (
                  <div className="patent-card-abstract">{patent.abstract}</div>
                )}
                <div className="patent-card-meta">
                  {getMethodBadge(patent.retrievalMethod)}
                  <span className="badge badge-source">{patent.source}</span>
                  {patent.publicationDate && (
                    <span>
                      {new Date(patent.publicationDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  )}
                  {patent.assignee && <span>· {patent.assignee}</span>}
                  {patent.isExpired ? (
                    <span className="badge badge-expired">Expired</span>
                  ) : patent.estimatedExpiry ? (
                    <span className="badge badge-active">Active</span>
                  ) : null}
                  {patent.userFlagged && (
                    <span className="badge badge-risk-medium">⚑ Flagged</span>
                  )}
                  {patent.userReviewed && (
                    <span className="badge badge-risk-low">✓ Reviewed</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {selectedPatent && (
            <div className="detail-panel">
              <div className="detail-section">
                <div className="detail-section-title">Patent Details</div>
                <div style={{ marginBottom: 8 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                    }}
                  >
                    {selectedPatent.patentNumber}
                  </span>
                </div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8 }}>
                  {selectedPatent.title}
                </h3>
                {selectedPatent.assignee && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                    <strong>Assignee:</strong> {selectedPatent.assignee}
                  </p>
                )}
                {selectedPatent.publicationDate && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                    <strong>Published:</strong>{' '}
                    {new Date(selectedPatent.publicationDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {getMethodBadge(selectedPatent.retrievalMethod)}
                  <span className={`score-badge ${getScoreClass(selectedPatent.relevanceScore)}`}>
                    {Math.round(selectedPatent.relevanceScore)}
                  </span>
                  {selectedPatent.isExpired ? (
                    <span className="badge badge-expired">
                      Expired{' '}
                      {selectedPatent.estimatedExpiry
                        ? `(est. ${new Date(selectedPatent.estimatedExpiry).getFullYear()})`
                        : ''}
                    </span>
                  ) : selectedPatent.estimatedExpiry ? (
                    <span className="badge badge-active">
                      Active until est.{' '}
                      {new Date(selectedPatent.estimatedExpiry).getFullYear()}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Abstract</div>
                <div className="detail-section-body">
                  {selectedPatent.abstract || 'No abstract available.'}
                </div>
              </div>

              {selectedPatent.aiExplanation && (
                <>
                  <div className="detail-section">
                    <div className="detail-section-title">
                      AI Analysis{' '}
                      <span
                        className={`confidence-${selectedPatent.aiExplanation.confidence}`}
                        style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}
                      >
                        ({selectedPatent.aiExplanation.confidence} confidence)
                      </span>
                    </div>
                    <div className="detail-section-body">
                      <p style={{ marginBottom: 12 }}>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          Why retrieved:
                        </strong>{' '}
                        {selectedPatent.aiExplanation.reason}
                      </p>
                      <p style={{ marginBottom: 12 }}>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          Similar aspects:
                        </strong>{' '}
                        {selectedPatent.aiExplanation.similarAspects}
                      </p>
                      <p style={{ marginBottom: 12 }}>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          Potential overlap:
                        </strong>{' '}
                        {selectedPatent.aiExplanation.overlap}
                      </p>
                      {selectedPatent.aiExplanation.confidenceReason && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                          {selectedPatent.aiExplanation.confidenceReason}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="actions-row">
                <button
                  className={`btn btn-sm ${
                    selectedPatent.userReviewed ? 'btn-primary' : 'btn-secondary'
                  }`}
                  onClick={() => handleReviewed(selectedPatent)}
                >
                  {selectedPatent.userReviewed ? '✓ Reviewed' : 'Mark Reviewed'}
                </button>
                <button
                  className={`btn btn-sm ${
                    selectedPatent.userFlagged ? 'btn-primary' : 'btn-ghost'
                  }`}
                  style={
                    selectedPatent.userFlagged
                      ? { background: 'var(--risk-medium)', borderColor: 'var(--risk-medium)' }
                      : {}
                  }
                  onClick={() => handleFlag(selectedPatent)}
                >
                  {selectedPatent.userFlagged ? '⚑ Flagged' : '⚑ Flag for Review'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : !isProcessing ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-text">
            No patents found for this compound. This may indicate low patent risk.
          </div>
        </div>
      ) : null}
    </div>
  );
}
