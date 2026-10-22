"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export function useUnsavedChanges() {
  const current = useRef(false),
    [dirty, setValue] = useState(false);
  const setDirty = useCallback((value: boolean) => {
    current.current = value;
    setValue(value);
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        current.current &&
        link &&
        link.target !== "_blank" &&
        !window.confirm("Descartar alterações não salvas?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const navigate = (event: Event) => {
      if (
        current.current &&
        !window.confirm("Descartar altera��es n�o salvas?")
      )
        event.preventDefault();
    };
    const discard = () => setDirty(false);
    window.addEventListener("agromind:before-navigation", navigate);
    window.addEventListener("agromind:discard-unsaved", discard);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("agromind:before-navigation", navigate);
      window.removeEventListener("agromind:discard-unsaved", discard);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [setDirty]);
  return { dirty, setDirty };
}
