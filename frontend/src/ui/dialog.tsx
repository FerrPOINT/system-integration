import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { Button } from './button';

// Consumed Base Dialog parts: Radix owns the portal, modal focus and dismissal.
export function Dialog({ open, title, description, onClose, pending = false, returnFocusRef, children }: {
  open: boolean; title: string; description: string; onClose: () => void; pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  return <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next && !pending) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="base-dialog-overlay" />
      <DialogPrimitive.Content className="base-dialog-content" aria-busy={pending} onCloseAutoFocus={event => {
        if (returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus(); }
      }}>
        <div className="base-dialog-header">
          <DialogPrimitive.Title className="base-dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="base-dialog-description">{description}</DialogPrimitive.Description>
        </div>
        {children}
        <DialogPrimitive.Close asChild><Button type="button" className="base-icon-button base-dialog-close"
          aria-label="Закрыть" title="Закрыть" disabled={pending}><X size={20} aria-hidden="true" /></Button></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
