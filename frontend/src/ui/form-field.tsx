import type { ReactNode } from 'react';
import { Label } from './label';
import { Notice } from './notice';

export function FormField({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: (attrs: {
    id: string;
    required?: boolean;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const describedBy =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="base-form-field">
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden> *</span>}
      </Label>
      {children({
        id,
        required,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint && (
        <p id={`${id}-hint`} className="base-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <Notice
          role="alert"
          tone="danger"
          appearance="inline"
          id={`${id}-error`}
        >
          {error}
        </Notice>
      )}
    </div>
  );
}
