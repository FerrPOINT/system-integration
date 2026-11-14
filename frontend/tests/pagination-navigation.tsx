import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useNavigate } from 'react-router-dom';
import { usePagination } from '../src/shared/lib/pagination/use-pagination';

// Control observer delivery to reproduce a queued layout measurement in the same
// turn as navigation. The hook is production code; the router setup matches main.tsx.
const observers = new Set<ResizeObserverCallback>();
const frames = new Map<number, FrameRequestCallback>();
let frame = 0;
window.ResizeObserver = class {
  constructor(private callback: ResizeObserverCallback) {}
  observe() { observers.add(this.callback); }
  unobserve() {}
  disconnect() { observers.delete(this.callback); }
} as unknown as typeof ResizeObserver;
window.requestAnimationFrame = callback => { frames.set(++frame, callback); return frame; };
window.cancelAnimationFrame = id => { frames.delete(id); };
function measure() {
  observers.forEach(callback => callback([], {} as ResizeObserver));
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(performance.now()));
}
function Source() {
  const navigate = useNavigate();
  const { viewportRef, size } = usePagination();
  return <>
    <h1>Source</h1><output>{size}</output>
    <div ref={viewportRef} style={{ height: 300 }}>
      <div data-page-items><div data-page-item style={{ height: 50 }}>Row</div></div>
    </div>
    <button onClick={measure}>Measure initial layout</button>
    <button onClick={() => {
      document.querySelector<HTMLElement>('[data-page-item]')!.style.height = '100px';
      measure();
      navigate('/destination');
    }}>Navigate with queued measurement</button>
    <button onClick={() => {
      document.querySelector<HTMLElement>('[data-page-item]')!.style.height = '100px';
      measure();
      navigate('?filter=active&size=' + size);
    }}>Filter with queued measurement</button>
  </>;
}
const router = createBrowserRouter([
  { path: '/destination', element: <h1>Destination</h1> },
  { path: '*', element: <Source /> },
]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
