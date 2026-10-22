import { requireProperty } from '@/lib/auth-server';
import { StockWorkspace } from '@/components/stock-workspace';
export const metadata={title:'Meus insumos | AgroMind'};
export default async function InventoryPage(){const {property}=await requireProperty();return <StockWorkspace property={property}/>;}
