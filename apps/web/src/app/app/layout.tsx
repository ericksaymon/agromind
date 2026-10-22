import { Brand } from "@/components/brand";
import { AppNav } from "@/components/app-nav";
import { LogoutButton, PropertySelector } from "@/components/app-actions";
import { requireProperty } from "@/lib/auth-server";
import { Leaf, ShieldCheck } from "lucide-react";
export const metadata = { robots: { index: false, follow: false } };
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProperty();
  const role = { ADMIN: "Administrador", OPERATOR: "Operador", VIEWER: "Consulta" }[session.property.role];
  return <div className="real-app"><aside className="real-sidebar"><Brand /><PropertySelector properties={session.properties} activeId={session.property.id} /><AppNav /><div className="real-sidebar-note"><Leaf size={24} /><p>Seu espaço está pronto.<br /><strong>Vamos organizar o próximo passo.</strong></p></div><div className="real-profile"><span>{session.user.name.slice(0, 2).toUpperCase()}</span><div><strong>{session.user.name}</strong><small>{role}</small></div></div><LogoutButton /></aside><div className="real-app-main"><header className="real-app-header"><div><span>MINHA PROPRIEDADE</span><strong>{session.property.name}</strong></div><div className="app-header-right"><ShieldCheck size={16} /><span>Acesso protegido</span><details className="profile-menu"><summary aria-label={`${session.user.name.split(" ")[0]}, abrir menu da conta`}>{session.user.name.split(" ")[0]}</summary><div><strong>{session.user.name}</strong><small>{session.user.email}</small><span>{role}</span><LogoutButton /></div></details></div></header><main className="real-app-content">{children}</main></div></div>;
}
