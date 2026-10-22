import { requireProperty } from '@/lib/auth-server';
import { StockWorkspace } from '@/components/stock-workspace';
export const metadata={title:'Movimentações | AgroMind'};
export default async function MovementsPage(){const {property}=await requireProperty();return <StockWorkspace property={property} history/>;}
