import { requireProperty } from "@/lib/auth-server";
import { AnalysisWorkspace } from "@/components/analysis-workspace";
export const metadata = { title: "Visão geral | AgroMind" };
export default async function DashboardPage() {
  const { property } = await requireProperty();
  return <AnalysisWorkspace key={property.id} property={property} />;
}
