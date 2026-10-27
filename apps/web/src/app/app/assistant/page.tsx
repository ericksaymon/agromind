import { requireProperty } from "@/lib/auth-server";
import { WhatsappWorkspace } from "@/components/whatsapp-workspace";
import "./whatsapp.css";
export const metadata = { title: "Assistente WhatsApp | AgroMind" };
export default async function AssistantPage() {
  const session = await requireProperty();
  return <WhatsappWorkspace properties={session.properties.map(p => ({ id: p.id, name: p.name }))} activeId={session.property.id} />;
}
