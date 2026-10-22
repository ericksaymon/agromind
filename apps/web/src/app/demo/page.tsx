import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { DemoPanel } from "@/components/demo-panel";

export const metadata = { title: "Demonstração interativa | AgroMind", robots: { index: false, follow: false } };

export default function DemoPage() {
  return <main className="demo-page"><div className="demo-page-header"><Link href="/"><ArrowLeft size={15} /> Voltar para o AgroMind</Link><span>Propriedade fictícia. Nenhuma alteração é salva.</span><Link href="/#como-funciona">Como funciona <ArrowUpRight size={14} /></Link></div><h1 className="sr-only">Demonstração interativa do AgroMind</h1><DemoPanel standalone /></main>;
}
