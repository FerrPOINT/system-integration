import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { RootErrorBoundary, RouteErrorBoundary } from '../src/app/root-error-boundary';
import '../src/ui/design-tokens.css';
import '../src/ui/controls.css';
import '../src/ui/patterns.css';

function Crash(): ReactNode {
  if (new URLSearchParams(location.search).has('value')) throw { diagnostic: 'PRIVATE_DIAGNOSTIC' };
  throw new Error('PRIVATE_DIAGNOSTIC');
}
const nested = new URLSearchParams(location.search).has('nested');
const FailedChunk = lazy(async () => { throw new Error('PRIVATE_DIAGNOSTIC chunk'); });
const router = createMemoryRouter([{
  errorElement: <RootErrorBoundary />,
  element: <><nav aria-label="Fixture shell">Shell</nav><Outlet /></>,
  children: [
    { path: '/tasks', element: <><h1>Working page</h1><Link to="/crash">Break page</Link><Link to="/chunk">Break chunk</Link></> },
    { path: '/crash', element: <Crash />, ...(nested ? { errorElement: <RouteErrorBoundary /> } : {}) },
    { path: '/chunk', element: <Suspense fallback={<p>Loading chunk</p>}><FailedChunk /></Suspense>, ...(nested ? { errorElement: <RouteErrorBoundary /> } : {}) },
  ],
}], { initialEntries: ['/tasks'] });
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
