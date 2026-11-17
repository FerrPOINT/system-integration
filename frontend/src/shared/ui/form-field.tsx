import type { ReactNode } from 'react';
import { Label } from './label';

export function FormField({
  id,
  label,
  required,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  children: (attrs: { id: string; required?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const describedBy = hint ? `${id}-hint` : undefined;
  return (
    <div className="ui-form-field">
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden> *</span>}
      </Label>
      {children({
        id,
        required,
        'aria-describedby': describedBy,
      })}
      {hint && (
        <p id={`${id}-hint`} className="ui-field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
