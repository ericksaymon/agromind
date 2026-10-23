"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { continueAfterLogin, RequestError } from "@/lib/auth-client";
export default function Page() {
  const [error, setError] = useState("");
  useEffect(() => {
    void continueAfterLogin().catch((e) => {
      if (e instanceof RequestError && e.status === 401) window.location.replace("/entrar");
      else setError(e instanceof Error ? e.message : "Tente novamente em instantes.");
    });
  }, []);
  if (!error) return null;
  return <AuthFrame title="Vamos retomar seu acesso." description="Não foi possível abrir seu espaço agora.">
    <p role="alert">{error}</p>
    <Link className="button button-green" href="/entrar">Voltar para entrar</Link>
  </AuthFrame>;
}
