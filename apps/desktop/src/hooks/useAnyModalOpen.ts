import { useEffect, useState } from 'react';

const OPEN_MODAL_SELECTOR =
  '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]';

function hasOpenModal(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return Boolean(document.querySelector(OPEN_MODAL_SELECTOR));
}

export function useAnyModalOpen(): boolean {
  const [anyModalOpen, setAnyModalOpen] = useState<boolean>(() => hasOpenModal());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const sync = (): void => {
      setAnyModalOpen(hasOpenModal());
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'role'],
    });

    return () => observer.disconnect();
  }, []);

  return anyModalOpen;
}
