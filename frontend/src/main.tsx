import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { appRoutes } from './app/router';
import { Providers } from './app/providers';
import './shared/styles/design-tokens.css';
import './shared/styles/controls.css';
import './shared/styles/patterns.css';
import './shared/styles/layout.css';
import './app/shell/shell.css';

const router = createBrowserRouter(appRoutes);
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
