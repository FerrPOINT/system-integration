import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, ScrollRestoration } from 'react-router-dom';
import { App } from './app/app';
import { Providers } from './app/providers';
import { RootErrorBoundary } from './app/root-error-boundary';
import './shared/styles/design-tokens.css';
import './shared/styles/controls.css';
import './shared/styles/patterns.css';
import './app/shell/shell.css';

const router = createBrowserRouter([{ path: '*', errorElement: <RootErrorBoundary />, element: <><App /><ScrollRestoration getKey={location =>
  ['/tasks', '/issues'].includes(location.pathname) ? location.pathname + location.search : location.key} /></> }]);
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element is missing');
}

createRoot(container).render(
  <Providers>
    <RouterProvider router={router} />
  </Providers>,
);
