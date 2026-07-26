import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import NewAnalysis from './pages/NewAnalysis';
import AnalysisWorkspace from './pages/AnalysisWorkspace';
import ReportPage from './pages/ReportPage';
import HistoryPage from './pages/HistoryPage';
import './index.css';

export default function App() {
  return (
    <Router>
      <div className="app-layout">
        <aside className="app-sidebar">
          <div className="sidebar-logo">
            Patent<span>Pilot</span>
          </div>
          <nav className="sidebar-nav">
            <NavLink
              to="/new"
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span style={{ fontSize: '1.1rem' }}>+</span> New Analysis
            </NavLink>
            <div className="sidebar-section-label">Workspace</div>
            <NavLink
              to="/history"
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              🕒 History
            </NavLink>
          </nav>
        </aside>
        
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/new" replace />} />
            <Route path="/new" element={<NewAnalysis />} />
            <Route path="/analysis/:id" element={<AnalysisWorkspace />} />
            <Route path="/analysis/:id/report" element={<ReportPage />} />
            <Route path="/history" element={<HistoryPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
