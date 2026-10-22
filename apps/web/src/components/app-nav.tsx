"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, LayoutDashboard, Package, ArrowLeftRight } from "lucide-react";
export function AppNav() {
  const pathname = usePathname();
  return <nav aria-label="Navegação da propriedade" className="real-app-nav">{[{ href: "/app", label: "Visão geral", icon: LayoutDashboard }, { href: "/app/importar", label: "Importar estoque", icon: FileSpreadsheet }, { href: "/app/estoque", label: "Meus insumos", icon: Package }, { href: "/app/movimentacoes", label: "Movimentações", icon: ArrowLeftRight }].map(({ href, label, icon: Icon }) => <Link prefetch={false} key={href} href={href} aria-current={(pathname === href || (href !== "/app" && pathname.startsWith(href + "/"))) ? "page" : undefined}><Icon size={18} />{label}</Link>)}</nav>;
}
