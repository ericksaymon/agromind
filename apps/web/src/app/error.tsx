"use client";
import Link from "next/link";
import { RefreshCw, Sprout } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="connection-error"><Sprout size={38} /><h1>Vamos tentar de novo?</h1><p>Não foi possível carregar esta área agora. Confira se o serviço local e o banco estão em execução.</p><button className="button button-green" onClick={reset}><RefreshCw size={16} />Tentar novamente</button><Link href="/">Voltar para o início</Link></main>;
}
