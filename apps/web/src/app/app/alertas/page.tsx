import { requireProperty } from "@/lib/auth-server";
import { AnalysisWorkspace } from "@/components/analysis-workspace";
export const metadata = { title: "Alertas e decisões | AgroMind" };
export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ produto?: string }> }) {
  const { property } = await requireProperty();
  const { produto } = await searchParams;
  return <AnalysisWorkspace key={`${property.id}:${produto ?? ""}`} property={property} alertsOnly initialSearch={produto} />;
}
