import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SiteLayout } from './layouts/SiteLayout';
import { DocsLayout } from './components/docs/DocsLayout';
import { HomePage } from './pages/HomePage';
import { DocsLandingPage } from './pages/DocsLandingPage';
import { UpdatesPage } from './pages/UpdatesPage';
import { UpdateDetailPage } from './pages/UpdateDetailPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PageView } from './pages/PageView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="docs" element={<DocsLandingPage />} />
          <Route path="docs/*" element={<DocsLayout />}>
            <Route path="*" element={<PageView />} />
          </Route>
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="updates/:slug" element={<UpdateDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/zh" element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="docs" element={<DocsLandingPage />} />
          <Route path="docs/*" element={<DocsLayout />}>
            <Route path="*" element={<PageView />} />
          </Route>
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="updates/:slug" element={<UpdateDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
