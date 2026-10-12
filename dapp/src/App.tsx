import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { Layout } from 'components/shell';
import { NotFound } from 'pages/NotFound';
import { routes } from 'routes';

export const App = () => (
  <Router>
    <Layout>
      <Routes>
        {routes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={<route.component />}
          />
        ))}
        <Route path='*' element={<NotFound />} />
      </Routes>
    </Layout>
  </Router>
);
