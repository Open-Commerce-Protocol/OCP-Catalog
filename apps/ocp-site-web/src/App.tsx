import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SiteLayout } from './layouts/SiteLayout';
import { DocsLayout } from './components/docs/DocsLayout';
import { HomePage } from './pages/HomePage';
import { DocsLandingPage } from './pages/DocsLandingPage';
import { UpdatesPage } from './pages/UpdatesPage';
import { UpdateDetailPage } from './pages/UpdateDetailPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductOcpCatalogPage } from './pages/ProductOcpCatalogPage';
import { RoadmapPage } from './pages/RoadmapPage';
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
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/ocp-catalog" element={<ProductOcpCatalogPage />} />
          <Route path="directory" element={<Navigate to="/products/ocp-catalog" replace />} />
          <Route path="roadmap" element={<RoadmapPage />} />
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
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/ocp-catalog" element={<ProductOcpCatalogPage />} />
          <Route path="directory" element={<Navigate to="/zh/products/ocp-catalog" replace />} />
          <Route path="roadmap" element={<RoadmapPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
