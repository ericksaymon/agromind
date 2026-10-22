import { requireProperty } from "@/lib/auth-server";
import { IntelligenceWorkspace } from "@/components/intelligence-workspace";
export const metadata = { title: "Inteligência do estoque | AgroMind" };
export default async function IntelligencePage() {
  const { property } = await requireProperty();
  return <IntelligenceWorkspace key={property.id} property={property} />;
}
