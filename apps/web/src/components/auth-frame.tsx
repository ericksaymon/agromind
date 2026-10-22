import Link from "next/link";
import { ArrowLeft, Check, Leaf, ShieldCheck, Sprout } from "lucide-react";
import { Brand } from "./brand";

export function AuthFrame({ title, description, label = "BEM-VINDO AO AGROMIND", children, wide = false }: { title: string; description: string; label?: string; children: React.ReactNode; wide?: boolean }) {
  return <main className={`auth-page ${wide ? "auth-wide" : ""}`}>
    <aside className="auth-story"><Brand /><div className="auth-story-copy"><span className="eyebrow"><span className="eyebrow-line" /> DA PROPRIEDADE À DECISÃO</span><h2>Um começo simples.<br /><em>Uma gestão mais clara.</em></h2><p>Seu espaço para organizar os insumos e acompanhar o que merece atenção no campo.</p><div className="auth-story-example"><span><Sprout size={19} /> Sua propriedade, em um só lugar</span><div><Check size={16} /> Acesso individual e protegido</div><div><Check size={16} /> Informações da sua propriedade</div><div><Check size={16} /> Um passo de cada vez</div></div></div><div className="auth-story-bottom"><Leaf size={23} /><span>A inteligência da sua propriedade.</span></div><img className="auth-watermark" src="/brand/agromind-symbol.png" width="512" height="541" alt="" /></aside>
    <section className="auth-main"><Link href="/" className="auth-back"><ArrowLeft size={15} /> Voltar para o AgroMind</Link><div className="auth-card"><span className="eyebrow section-label">{label}</span><h1>{title}</h1><p className="auth-description">{description}</p>{children}</div><div className="auth-bottom"><ShieldCheck size={14} /><span>Seu acesso começa com segurança.</span><Link href="/privacidade">Privacidade</Link></div></section>
  </main>;
}
