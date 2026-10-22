import { requireProperty } from '@/lib/auth-server';
import { StockWorkspace } from '@/components/stock-workspace';
export const metadata={title:'Detalhe do insumo | AgroMind'};
export default async function ProductPage({params}:{params:Promise<{id:string}>}){const {property}=await requireProperty();const {id}=await params;return <StockWorkspace property={property} productId={id}/>;}
