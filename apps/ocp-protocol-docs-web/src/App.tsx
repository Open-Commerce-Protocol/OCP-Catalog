import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageView } from './pages/PageView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path=":slug" element={<PageView />} />
          <Route path=":section/:slug" element={<PageView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
