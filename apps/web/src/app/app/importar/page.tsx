import { requireProperty } from '@/lib/auth-server';
import { ImportWorkspace } from '@/components/import-workspace';
export const metadata={title:'Importar estoque | AgroMind'};
export default async function ImportPage(){const {property}=await requireProperty();return <ImportWorkspace property={property}/>;}
