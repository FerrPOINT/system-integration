import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
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

export function DiscardDialog({ open, onCancel, onDiscard }: {
  open: boolean; onCancel: () => void; onDiscard: () => void;
}) {
  return <AlertDialogPrimitive.Root open={open} onOpenChange={next => { if (!next) onCancel(); }}>
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="base-dialog-overlay" />
      <AlertDialogPrimitive.Content className="base-dialog-content">
        <div className="base-dialog-header">
          <AlertDialogPrimitive.Title className="base-dialog-title">Закрыть форму?</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="base-dialog-description">Введённые данные будут потеряны.</AlertDialogPrimitive.Description>
        </div>
        <div className="base-dialog-footer">
          <AlertDialogPrimitive.Cancel asChild><Button>Продолжить заполнение</Button></AlertDialogPrimitive.Cancel>
          <Button variant="default" onClick={onDiscard}>Не сохранять</Button>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  </AlertDialogPrimitive.Root>;
}
