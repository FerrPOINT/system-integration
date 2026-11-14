import { Link } from 'react-router-dom';
import { Button } from '../shared/ui/button';
import { Notice } from '../shared/ui/notice';
import { ActionGroup } from '../shared/ui/action-group';

/** Render failures are distinct from expected HTTP/validation errors in the screen. */
export function RouteErrorBoundary() {
  return <section className="base-page-stack" aria-labelledby="page-error-title">
    <h1 id="page-error-title">Не удалось открыть страницу</h1>
    <Notice tone="danger" role="alert">Произошла ошибка. Обновите страницу или вернитесь к заданиям.</Notice>
    <ActionGroup align="start">
      <Button onClick={() => window.location.reload()}>Обновить страницу</Button>
      <Button asChild><Link to="/tasks">К заданиям</Link></Button>
    </ActionGroup>
  </section>;
}

export function RootErrorBoundary() {
  return <main className="base-page-stack"><RouteErrorBoundary /></main>;
}
