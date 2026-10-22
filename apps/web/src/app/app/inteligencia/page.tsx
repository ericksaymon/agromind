import { requireProperty } from "@/lib/auth-server";
import { IntelligenceWorkspace } from "@/components/intelligence-workspace";
export const metadata = { title: "Inteligência do estoque | AgroMind" };
export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; tab?: string }>;
}) {
  const [{ property }, query] = await Promise.all([
    requireProperty(),
    searchParams,
  ]);
  const initialTab = query.tab === "planning" ? "planning" : "consumption";
  const productId =
    typeof query.productId === "string" &&
    /^[0-9a-f-]{36}$/i.test(query.productId)
      ? query.productId
      : "";
  return (
    <IntelligenceWorkspace
      key={`${property.id}:${productId}:${initialTab}`}
      property={property}
      initialProductId={productId}
      initialTab={initialTab}
    />
  );
}
