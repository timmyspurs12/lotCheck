import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import AppShell from './components/AppShell';
import { Button } from './components/ui';
import OverviewPage from './pages/OverviewPage';
import SitesPage from './pages/SitesPage';
import SiteDetailPage from './pages/SiteDetailPage';
import ReviewsPage from './pages/ReviewsPage';
import ReviewDetailPage from './pages/ReviewDetailPage';
import NewReviewPage from './pages/NewReviewPage';
import RecordsPage from './pages/RecordsPage';
import RecordDetailPage from './pages/RecordDetailPage';
import EvidenceDetailPage from './pages/EvidenceDetailPage';
import SystemStatusPage from './pages/SystemStatusPage';

function NotFoundPage() {
  return (
    <div className="page-content not-found-page">
      <div className="not-found-illustration"><FileQuestion size={25} /></div>
      <div className="eyebrow">ROUTE NOT FOUND</div>
      <h1>This page is not in the workspace.</h1>
      <p>The requested LotCheck route could not be found.</p>
      <div><Button variant="secondary" icon={<ArrowLeft size={14} />} href="/overview">Back to overview</Button><Link to="/system" className="not-found-link">Check system status</Link></div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="sites/:siteId" element={<SiteDetailPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="reviews/new" element={<NewReviewPage />} />
        <Route path="reviews/:reviewId" element={<ReviewDetailPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="record/:recordId" element={<RecordDetailPage />} />
        <Route path="evidence/:evidenceId" element={<EvidenceDetailPage />} />
        <Route path="system" element={<SystemStatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
