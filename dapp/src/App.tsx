import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { Layout } from 'components/shell';
import { NotFound } from 'pages/NotFound';
import { routes } from 'routes';

// A data router, so a page can hold back an in-app navigation that would lose
// its record (Create with transactions half done): only a data router has
// useBlocker.
const router = createBrowserRouter([
  {
    element: (
      <Layout>
        <Outlet />
      </Layout>
    ),
    children: [
      ...routes.map((route) => ({
        path: route.path,
        element: <route.component />
      })),
      { path: '*', element: <NotFound /> }
    ]
  }
]);

export const App = () => <RouterProvider router={router} />;
