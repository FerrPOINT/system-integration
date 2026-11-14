import { useRef, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '../../shared/ui/button';
import { Dialog } from '../../shared/ui/dialog';

export function MobileAccountMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} className="base-icon-button mobile-account-trigger" aria-label="Меню приложения" title="Меню приложения"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22} aria-hidden="true" /></Button>
    <Dialog open={open} title="Меню приложения" description="Тема и учётная запись." onClose={() => setOpen(false)} returnFocusRef={trigger}>
      <div className="base-dialog-body mobile-account-menu">{children}</div>
    </Dialog>
  </>;
}
