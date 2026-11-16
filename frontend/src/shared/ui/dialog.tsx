import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from './button';

// Consumed Base Dialog parts: Radix owns the portal, modal focus and dismissal.
export function Dialog({
  open,
  title,
  description,
  onClose,
  pending = false,
  returnFocusRef,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="base-dialog-overlay" />
        <DialogPrimitive.Content
          className="base-dialog-content"
          aria-busy={pending}
          onCloseAutoFocus={(event) => {
            if (returnFocusRef?.current) {
              event.preventDefault();
              returnFocusRef.current.focus();
            }
          }}
        >
          <div className="base-dialog-header">
            <DialogPrimitive.Title className="base-dialog-title">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="base-dialog-description">{description}</DialogPrimitive.Description>
          </div>
          {children}
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              className="base-icon-button base-dialog-close"
              aria-label="Закрыть"
              title="Закрыть"
              disabled={pending}
            >
              <X size={20} aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DiscardDialog({
  open,
  onCancel,
  onDiscard,
  returnFocusRef,
  title = 'Закрыть форму?',
  description = 'Введённые данные будут потеряны.',
  discardLabel = 'Не сохранять',
  cancelLabel = 'Продолжить заполнение',
}: {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  title?: string;
  description?: string;
  discardLabel?: string;
  cancelLabel?: string;
}) {
  const returnTarget = useRef<HTMLElement | null>(null);
  // Closing resets the page blocker before Radix restores focus. Keep this dialog's opening target.
  useLayoutEffect(() => {
    if (open) returnTarget.current = returnFocusRef.current;
  }, [open, returnFocusRef]);
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="base-dialog-overlay" />
        <AlertDialogPrimitive.Content
          className="base-dialog-content"
          onCloseAutoFocus={(event) => {
            if (returnTarget.current?.isConnected) {
              event.preventDefault();
              returnTarget.current.focus();
            }
          }}
        >
          <div className="base-dialog-header">
            <AlertDialogPrimitive.Title className="base-dialog-title">{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="base-dialog-description">
              {description}
            </AlertDialogPrimitive.Description>
          </div>
          <div className="base-dialog-footer">
            <AlertDialogPrimitive.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant="default" onClick={onDiscard}>
              {discardLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
