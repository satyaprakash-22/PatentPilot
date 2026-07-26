import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAnalysis, getReport, getReportPdfUrl } from '../services/api';
import { Analysis, Report } from '../types';

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      try {
        const [analysisData, reportData] = await Promise.all([
          getAnalysis(id),
          getReport(id),
        ]);
        setAnalysis(analysisData);
        setReport(reportData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="report-container">
        <div className="skeleton skeleton-text" style={{ width: 300, height: 24 }} />
        <div className="skeleton skeleton-text medium" style={{ marginTop: 16, height: 16 }} />
        <div className="skeleton" style={{ height: 200, marginTop: 24 }} />
        <div className="skeleton" style={{ height: 150, marginTop: 16 }} />
        <div className="skeleton" style={{ height: 150, marginTop: 16 }} />
      </div>
    );
  }

  if (error || !report || !analysis) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-text">
          {error || 'Report not found. Generate it from the workspace first.'}
        </div>
        <button className="btn btn-primary" onClick={() => navigate(id ? `/analysis/${id}` : '/new')}>
          {id ? 'Go to Workspace' : 'New Analysis'}
        </button>
      </div>
    );
  }

  const getRecBadgeClass = (rec: string) => {
    switch (rec) {
      case 'low_risk': return 'badge-risk-low';
      case 'high_risk': return 'badge-risk-high';
      default: return 'badge-risk-medium';
    }
  };

  const getRecLabel = (rec: string) => {
    switch (rec) {
      case 'low_risk': return 'Low Patent Risk';
      case 'high_risk': return 'High Patent Risk';
      case 'expert_review': return 'Requires Expert Review';
      default: return rec;
    }
  };

  const getRecBgColor = (rec: string) => {
    switch (rec) {
      case 'low_risk': return 'var(--risk-low-bg)';
      case 'high_risk': return 'var(--risk-high-bg)';
      default: return 'var(--risk-medium-bg)';
    }
  };

  return (
    <div className="report-container">
      <div className="report-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">FTO Patentability Report</h1>
            <p className="page-subtitle" style={{ marginTop: 4 }}>
              <code style={{ fontFamily: 'var(--font-mono)' }}>{analysis.smiles}</code>
              {analysis.compoundName && ` — ${analysis.compoundName}`}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
              Generated {new Date(report.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/analysis/${id}`)}
            >
              ← Workspace
            </button>
            <a
              href={getReportPdfUrl(analysis.id)}
              className="btn btn-primary btn-sm"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              ↓ Download PDF
            </a>
          </div>
        </div>

        <div
          className={`report-recommendation ${getRecBadgeClass(report.recommendation)}`}
          style={{ background: getRecBgColor(report.recommendation) }}
        >
          {report.recommendation === 'low_risk' && '✓ '}
          {report.recommendation === 'high_risk' && '⚠ '}
          {report.recommendation === 'expert_review' && '⚡ '}
          {getRecLabel(report.recommendation)}
        </div>
      </div>

      {/* Molecule info */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.8rem' }}>
          {analysis.formula && (
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Formula: </span>
              <code>{analysis.formula}</code>
            </div>
          )}
          {analysis.molecularWeight && (
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>MW: </span>
              {analysis.molecularWeight.toFixed(2)} g/mol
            </div>
          )}
          {analysis.target && (
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Target: </span>
              {analysis.target}
            </div>
          )}
          {analysis.disease && (
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Disease: </span>
              {analysis.disease}
            </div>
          )}
          <div>
            <span style={{ color: 'var(--text-tertiary)' }}>Patents found: </span>
            {analysis.patents?.length || 0}
          </div>
        </div>
      </div>

      {/* Report sections */}
      <div className="report-section">
        <h2 className="report-section-title">Executive Summary</h2>
        <div className="report-section-body">{report.executiveSummary}</div>
      </div>

      <div className="report-section">
        <h2 className="report-section-title">Key Similar Patents</h2>
        <div className="report-section-body">{report.keySimilarPatents}</div>
      </div>

      <div className="report-section">
        <h2 className="report-section-title">Potential Novelty Concerns</h2>
        <div className="report-section-body">{report.noveltyConcerns}</div>
      </div>

      <div className="report-section">
        <h2 className="report-section-title">Patents Requiring Manual Review</h2>
        <div className="report-section-body">{report.manualReviewList}</div>
      </div>

      <div className="report-section">
        <h2 className="report-section-title">Scoring Rationale</h2>
        <div className="report-section-body">{report.rationale}</div>
      </div>

      {/* Disclaimer */}
      <div
        style={{
          marginTop: 40,
          padding: '12px 16px',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--border-radius)',
          fontSize: '0.75rem',
          color: 'var(--text-tertiary)',
          lineHeight: 1.5,
        }}
      >
        <strong>Disclaimer:</strong> This report is generated by PatentPilot using automated patent
        retrieval and AI analysis. It is not legal advice. Patent expiry estimates are based on
        publication date + 20 years and may not reflect actual patent status. Always consult a
        patent attorney for definitive FTO assessments.
      </div>
    </div>
  );
}
