"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BellRing, FileSpreadsheet, Package, RefreshCw, ShieldQuestion, X } from "lucide-react";
import { firstName, takeWelcome, type WelcomeNote } from "@/lib/welcome";
import "../app/welcome.css";

const cards = [
  { icon: BellRing, title: "Alertas com prioridade e motivo", text: "Falta, vencimento, excesso e consumo fora do normal chegam em ordem de urgência, com a conta que explica cada um." },
  { icon: RefreshCw, title: "Reanálise a cada movimentação", text: "Registrou uma compra ou uma retirada? A análise é refeita em segundos e os alertas acompanham." },
  { icon: ShieldQuestion, title: "O que falta não vira zero", text: "Custo, validade ou histórico ausentes aparecem como pendência, sem números inventados." },
];

export function WelcomeModal() {
  const [note, setNote] = useState<WelcomeNote | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  // Espera a tela verde da entrada se dissolver antes de abrir.
  useEffect(() => { const timer = window.setTimeout(() => setNote(takeWelcome()), 700); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (note && ref.current && !ref.current.open) ref.current.showModal(); }, [note]);
  if (!note) return null;
  const name = firstName(note.name);
  const close = () => { ref.current?.close(); setNote(null); };
  const next = note.method === "IMPORT"
    ? { icon: FileSpreadsheet, title: "Seu próximo passo: importar a planilha", text: "Você associa as colunas e confere cada linha antes de qualquer gravação." }
    : { icon: Package, title: "Seu próximo passo: cadastrar o primeiro insumo", text: "Informe unidade, lote e validade. Dá para organizar o resto aos poucos." };
  return <dialog ref={ref} className="welcome-modal" aria-labelledby="welcome-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="welcome-hero">
      <div className="welcome-brand"><img src="/brand/agromind-symbol.png" alt="" width="30" height="32" /><span>Bem-vindo ao AgroMind</span></div>
      <h2 id="welcome-title">{name ? `Olá, ${name}.` : "Tudo pronto."}</h2>
      <p>{note.property} já tem um espaço de trabalho. Veja o que o AgroMind faz com os registros da sua propriedade.</p>
      <button className="welcome-close" type="button" onClick={close} aria-label="Fechar"><X size={18} /></button>
    </header>
    <div className="welcome-body">
      <div className="welcome-next"><span><next.icon size={20} /></span><p><strong>{next.title}</strong><small>{next.text}</small></p></div>
      <ul className="welcome-cards">{cards.map(({ icon: Icon, title, text }) => <li key={title}><Icon size={18} /><span><strong>{title}</strong><small>{text}</small></span></li>)}</ul>
    </div>
    <footer className="welcome-foot"><button className="button button-green" type="button" autoFocus onClick={close}>Começar <ArrowRight size={16} /></button></footer>
  </dialog>;
}
