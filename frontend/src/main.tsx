import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './app/App';
import { queryClient } from './app/api';
import './ui/design-tokens.css';
import './ui/controls.css';
import './ui/patterns.css';
import './app/styles.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element is missing');
}

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
