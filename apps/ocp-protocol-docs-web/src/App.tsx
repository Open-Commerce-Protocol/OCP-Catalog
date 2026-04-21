import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageView } from './pages/PageView';

function RootRedirect() {
  const location = useLocation();
  // With HashRouter, the location is the path part of the hash, e.g. `/`
  return <Navigate to={`/overview${location.search}`} replace />;
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<RootRedirect />} />
          <Route path=":slug" element={<PageView />} />
          <Route path=":section/:slug" element={<PageView />} />
          <Route path="*" element={<RootRedirect />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
