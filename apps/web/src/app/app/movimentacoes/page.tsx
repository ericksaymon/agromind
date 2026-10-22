import { requireProperty } from "@/lib/auth-server";
import { StockWorkspace } from "@/components/stock-workspace";
export const metadata = { title: "Movimentações | AgroMind" };
export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ productId?: string; kind?: string; from?: string; to?: string }> }) {
  const { property } = await requireProperty();
  const { productId, kind, from, to } = await searchParams;
  return <StockWorkspace key={`${property.id}:${productId ?? ""}:${kind ?? ""}:${from ?? ""}:${to ?? ""}`} property={property} history historyProductId={productId} historyFilters={{ kind, from, to }} />;
}
