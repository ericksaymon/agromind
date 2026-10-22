import { requireProperty } from "@/lib/auth-server";
import { StockWorkspace } from "@/components/stock-workspace";
export const metadata = { title: "Movimentações | AgroMind" };
export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  const { property } = await requireProperty();
  const { productId } = await searchParams;
  return <StockWorkspace key={`${property.id}:${productId ?? ""}`} property={property} history historyProductId={productId} />;
}
