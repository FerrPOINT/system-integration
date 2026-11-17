import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { RootErrorBoundary, RouteErrorBoundary } from '../src/app/root-error-boundary';
import { useMediaQuery } from '../src/shared/ui/use-media-query';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';

function RequiredMedia() {
  const mobile = useMediaQuery('(max-width: 760px)');
  return <p>{mobile ? 'Mobile' : 'Desktop'}</p>;
}

function Crash(): ReactNode {
  if (new URLSearchParams(location.search).has('media')) return <RequiredMedia />;
  if (new URLSearchParams(location.search).has('value')) throw { diagnostic: 'PRIVATE_DIAGNOSTIC' };
  throw new Error('PRIVATE_DIAGNOSTIC');
}
const nested = new URLSearchParams(location.search).has('nested');
const router = createMemoryRouter(
  [
    {
      errorElement: <RootErrorBoundary />,
      element: (
        <>
          <nav aria-label="Fixture shell">Shell</nav>
          <Outlet />
        </>
      ),
      children: [
        {
          path: '/tasks',
          element: (
            <>
              <h1>Working page</h1>
              <Link to="/crash">Break page</Link>
            </>
          ),
        },
        { path: '/crash', element: <Crash />, ...(nested ? { errorElement: <RouteErrorBoundary /> } : {}) },
      ],
    },
  ],
  { initialEntries: ['/tasks'] },
);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
