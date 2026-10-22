import Link from "next/link";

export function Brand({ small = false }: { small?: boolean }) {
  return <Link className={`brand ${small ? "brand-small" : ""}`} href="/" title="Página inicial do AgroMind">
    {/* Símbolo original extraído do PDF fornecido, preservado sem alteração. */}
    <img src="/brand/agromind-symbol.png" alt="" width="40" height="42" />
    <span>Agro<span className="brand-mind">Mind</span><small>A INTELIGÊNCIA DA SUA PROPRIEDADE</small></span>
  </Link>;
}
