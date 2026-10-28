"use client";

import { useEffect } from "react";
import { ENTER_FLAG } from "@/lib/enter-app";

/** Dissolve a tela verde com que a página abriu depois do login (a cobertura vem do script em app/layout.tsx). */
export function EnterReveal() {
  useEffect(() => {
    const root = document.documentElement;
    try { sessionStorage.removeItem(ENTER_FLAG); } catch { /* ignora */ }
    if (!root.classList.contains("enter-cover")) return;
    const done = () => root.classList.remove("enter-cover", "is-revealing");
    // Dois quadros: deixa o app pintar por baixo antes de começar a dissolver.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-revealing")));
    const cleanup = window.setTimeout(done, 400);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(cleanup); };
  }, []);
  return null;
}
