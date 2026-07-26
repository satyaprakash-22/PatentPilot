import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAnalyses } from '../services/api';
import { Analysis } from '../types';

export default function HistoryPage() {
  const navigate = useNavigate();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAnalyses = async () => {
      try {
        const data = await listAnalyses();
        setAnalyses(data);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch history.');
      } finally {
        setLoading(false);
      }
    };
    fetchAnalyses();
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Analysis History</h1>
        </div>
        <div className="history-list">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, marginBottom: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚠</div>
        <div className="empty-state-text">{error}</div>
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🕒</div>
        <div className="empty-state-text">No past analyses found.</div>
        <button className="btn btn-primary" onClick={() => navigate('/new')}>
          Start New Analysis
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Analysis History</h1>
          <p className="page-subtitle">Past FTO assessments</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/new')}>
          + New Analysis
        </button>
      </div>

      <div className="history-list">
        {analyses.map((analysis) => (
          <div
            key={analysis.id}
            className="history-item"
            onClick={() => navigate(`/analysis/${analysis.id}`)}
          >
            <div>
              <div className="history-item-molecule">
                {analysis.smiles}
              </div>
              <div className="history-item-name">
                {analysis.compoundName || 'Unknown Compound'}
                {analysis.target && ` • Target: ${analysis.target}`}
              </div>
            </div>
            <div className="history-item-right">
              <div style={{ textAlign: 'right' }}>
                <div className="history-item-date">
                  {new Date(analysis.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {analysis._count?.patents || 0} patents
                </div>
              </div>
              {analysis.status === 'completed' && analysis.recommendation ? (
                <span
                  className={`badge badge-risk-${
                    analysis.recommendation === 'low_risk'
                      ? 'low'
                      : analysis.recommendation === 'high_risk'
                      ? 'high'
                      : 'medium'
                  }`}
                  style={{ width: 110, justifyContent: 'center' }}
                >
                  {analysis.recommendation === 'low_risk'
                    ? 'Low Risk'
                    : analysis.recommendation === 'high_risk'
                    ? 'High Risk'
                    : 'Expert Review'}
                </span>
              ) : (
                <span className="badge badge-source" style={{ width: 110, justifyContent: 'center' }}>
                  {analysis.status === 'error' ? 'Failed' : 'In Progress'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
