import {PropertyAccessBoundary} from "@/components/property-access-boundary";
import { Brand } from "@/components/brand";
import { AppNav } from "@/components/app-nav";
import { ProfileMenu, PropertySelector } from "@/components/app-actions";
import { requireProperty } from "@/lib/auth-server";
export const metadata = { robots: { index: false, follow: false } };
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProperty();
  const role = { ADMIN: "Administrador", OPERATOR: "Operador", VIEWER: "Consulta" }[session.property.role];
  return <div className="real-app"><aside className="app-sidebar"><Brand /><AppNav /></aside><div className="real-app-main"><header className="app-topbar"><PropertySelector properties={session.properties} activeId={session.property.id} /><ProfileMenu name={session.user.name} email={session.user.email} role={role} /></header><main className="real-app-content"><PropertyAccessBoundary key={`${session.property.id}:${session.property.role}`} propertyId={session.property.id}>{children}</PropertyAccessBoundary></main></div></div>;
}
