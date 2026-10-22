"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export function PropertyAccessBoundary({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  const [blocked, setBlocked] = useState(false),
    router = useRouter();
  useEffect(() => {
    const deny = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail;
      if (detail.path.startsWith(`/api/properties/${propertyId}`)) {
        setBlocked(true);
        router.refresh();
      }
    };
    window.addEventListener("agromind:access-denied", deny);
    return () => window.removeEventListener("agromind:access-denied", deny);
  }, [propertyId, router]);
  if (blocked)
    return (
      <section className="settings-card" role="alert">
        <h1>Precisamos atualizar seu acesso</h1>
        <p>
          Esta propriedade ou operação não está disponível para a sua sessão
          atual. Seus dados anteriores foram retirados desta tela.
        </p>
        <Link href="/app">Voltar ao painel</Link> ·{" "}
        <Link href="/conta">Minha conta</Link>
      </section>
    );
  return children;
}
