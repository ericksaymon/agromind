"use client";
import { useEffect, useState } from "react";
import { continueAfterLogin } from "@/lib/auth-client";
export default function Page() {
  const [error, setError] = useState("");
  useEffect(() => {
    void continueAfterLogin().catch((e) => setError(e.message));
  }, []);
  return (
    <main className="account-page">
      <h1>Continuando seu acesso</h1>
      {error ? (
        <p role="alert">
          {error} <a href="/entrar">Entrar</a>
        </p>
      ) : (
        <p role="status">Conferindo sua conta…</p>
      )}
    </main>
  );
}
