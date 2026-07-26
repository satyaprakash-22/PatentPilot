import { Analysis, Patent, Report } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// Analyses
export async function createAnalysis(data: {
  smiles: string;
  target?: string;
  disease?: string;
}): Promise<Analysis> {
  return request<Analysis>('/analyses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listAnalyses(): Promise<Analysis[]> {
  return request<Analysis[]>('/analyses');
}

export async function getAnalysis(id: string): Promise<Analysis> {
  return request<Analysis>(`/analyses/${id}`);
}

// Patents
export async function updatePatent(
  analysisId: string,
  patentId: string,
  data: { userFlagged?: boolean; userReviewed?: boolean }
): Promise<Patent> {
  return request<Patent>(`/analyses/${analysisId}/patents/${patentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Reports
export async function generateReport(analysisId: string): Promise<Report> {
  return request<Report>(`/analyses/${analysisId}/report`, {
    method: 'POST',
  });
}

export async function getReport(analysisId: string): Promise<Report> {
  return request<Report>(`/analyses/${analysisId}/report`);
}

export function getReportPdfUrl(analysisId: string): string {
  return `${API_BASE}/analyses/${analysisId}/report/pdf`;
}
