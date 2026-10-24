"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, FileSpreadsheet, LayoutDashboard, Package, ArrowLeftRight, BellRing, ChartNoAxesCombined } from "lucide-react";
const groups = [
  { label: "", items: [{ href: "/app", label: "Visão geral", icon: LayoutDashboard }] },
  { label: "ANÁLISE", items: [{ href: "/app/inteligencia", label: "Inteligência", icon: ChartNoAxesCombined }, { href: "/app/alertas", label: "Alertas e decisões", icon: BellRing }] },
  { label: "ESTOQUE", items: [{ href: "/app/estoque", label: "Meus insumos", icon: Package }, { href: "/app/movimentacoes", label: "Movimentações", icon: ArrowLeftRight }, { href: "/app/importar", label: "Importar planilha", icon: FileSpreadsheet }] },
  { label: "PROPRIEDADE", items: [{ href: "/app/configuracoes", label: "Configurações", icon: Settings }] },
];
export function AppNav() {
  const pathname = usePathname();
  return <nav aria-label="Navegação da propriedade" className="app-nav">{groups.map(({ label, items }) => <div className="app-nav-group" key={label || "main"}>{label && <p>{label}</p>}{items.map(({ href, label, icon: Icon }) => <Link prefetch={false} key={href} href={href} aria-current={(pathname === href || (href !== "/app" && pathname.startsWith(href + "/"))) ? "page" : undefined}><Icon size={18} />{label}</Link>)}</div>)}</nav>;
}
