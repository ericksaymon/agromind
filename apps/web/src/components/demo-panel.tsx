"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, ChevronDown, CircleCheck, Clock3, Droplets, LayoutDashboard, Leaf, Package, RotateCcw, Search, ShieldCheck, Sprout, TriangleAlert, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { dailyConsumption, DemoView, formatCurrency, formatNumber, products, questions } from "@/lib/demo-data";

const titles: Record<DemoView, string> = { overview: "Visão geral", stock: "Estoque de insumos", diesel: "Diesel S10", expiry: "Validades e lotes" };

export function DemoPanel({ standalone = false }: { standalone?: boolean }) {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<DemoView>("overview");
  const [diesel, setDiesel] = useState(420);
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState("150");
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const days = diesel / 60;
  const total = 14538 + (diesel - 420) * 6.1;
  const activeQuestion = questions.find((q) => q.view === view);
  const invalidQuantity = !Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > diesel;
  useEffect(() => { setReady(true); }, []);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [view]);

  function reset() { setDiesel(420); setQuantity("150"); setSearch(""); setNotice("Dados de exemplo reiniciados."); setView("overview"); }
  function openMovement() { setConfirming(false); setQuantity(String(Math.min(150, diesel))); dialog.current?.showModal(); }
  function saveMovement() {
    if (invalidQuantity) return;
    const amount = Number(quantity);
    setDiesel((current) => current - amount);
    setNotice(`Retirada de ${formatNumber(amount, 2)} L simulada. Nenhum dado real foi alterado.`);
    setView("diesel");
    dialog.current?.close();
  }

  return <div className={`demo-module ${standalone ? "demo-standalone" : ""}`} inert={!ready} aria-busy={!ready} data-ready={ready}>
    <div className="demo-questions" role="group" aria-label="Escolha uma pergunta para explorar a demonstração">
      <span className="eyebrow">EXPERIMENTE</span>
      {questions.map((question, i) => <button key={question.view} type="button" aria-pressed={view === question.view} onClick={() => { setView(question.view); setNotice(""); }}>
        {i === 0 ? <Package size={15} /> : i === 1 ? <Droplets size={15} /> : <Clock3 size={15} />}{question.label}
      </button>)}
      <p aria-live="polite">{activeQuestion?.note ?? "Explore os seis produtos da propriedade de exemplo."}</p>
    </div>
    <div className="dashboard">
      <aside className="dashboard-sidebar">
        <Brand small />
        <div className="property-badge"><span className="property-icon"><Sprout size={17} /></span><span>Fazenda Boa Vista<small>Propriedade de exemplo</small></span><ChevronDown size={13} /></div>
        <div className="sidebar-label">SUA PROPRIEDADE</div>
        <nav aria-label="Navegação da demonstração">
          {([{ id: "overview", text: "Visão geral", icon: LayoutDashboard }, { id: "stock", text: "Estoque", icon: Package }, { id: "diesel", text: "Consumo de diesel", icon: Droplets }, { id: "expiry", text: "Validades", icon: Clock3 }] as const).map(({ id, text, icon: Icon }) => <button key={id} type="button" className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); setNotice(""); }}><Icon size={17} />{text}{id === "expiry" && <span className="nav-count">1</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><Leaf size={22} /><p>Decisões melhores.<br /><strong>Do estoque ao campo.</strong></p></div>
        <div className="demo-person"><span>JC</span><div>João Costa<small>Perfil de demonstração</small></div></div>
      </aside>
      <div className="dashboard-main">
        <div className="dashboard-top"><span>Minha propriedade <span>/</span> <strong>{titles[view]}</strong></span><span className="top-right"><span className="demo-tag"><span /> DEMONSTRAÇÃO</span><Bell size={17} aria-hidden="true" /></span></div>
        <div ref={content} className="dashboard-content" role="region" aria-label="Conteúdo da demonstração" tabIndex={0}>
          <div className="dashboard-heading"><div><span className="dashboard-date">21 DE OUTUBRO DE 2026 · DADOS FICTÍCIOS</span><h3>{view === "overview" ? "Bom dia, João." : titles[view]}</h3><p>{view === "overview" ? "Tudo o que merece atenção na sua propriedade." : view === "stock" ? "Seus insumos, organizados em um só lugar." : view === "diesel" ? "Saldo, consumo e planejamento de reposição." : "Antecipe perdas. Confira o que está perto de vencer."}</p></div><button className="button button-dashboard" aria-label="Simular retirada" onClick={openMovement} disabled={diesel <= 0}><ArrowUpRight size={15} /><span>Simular retirada</span></button></div>
          <div className="demo-mobile-nav" role="group" aria-label="Seções da demonstração">{(["overview", "stock", "diesel", "expiry"] as DemoView[]).map(id => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{id === "overview" ? "Resumo" : id === "diesel" ? "Diesel" : id === "expiry" ? "Validades" : "Estoque"}</button>)}</div>
          <p className="demo-notice" role="status">{notice}</p>
          {view === "overview" && <>
            <div className="metrics">
              <Metric label="Valor em estoque" value={formatCurrency(total)} detail="Custo conhecido dos 6 produtos" icon={<Package />} />
              <Metric label="Produtos cadastrados" value="06" detail="Em 6 categorias de insumos" icon={<Sprout />} />
              <Metric label="Precisam de atenção" value="02" detail="Reposição e estoque mínimo" warning icon={<TriangleAlert />} />
              <Metric label="Próximo do vencimento" value="01" detail="Lote vence nos próximos 30 dias" icon={<Clock3 />} />
            </div>
            <div className="dashboard-grid">
              <section className="priorities"><div className="panel-title"><h4>O que precisa da sua atenção hoje?</h4><span>3 prioridades</span></div>
                <button className="priority-row" onClick={() => setView("diesel")}><span className="priority-icon amber"><Droplets size={18} /></span><span><strong>Hora de planejar o abastecimento</strong><small>Diesel S10 · {formatNumber(diesel, 2)} L disponíveis</small></span><span className="priority-trailing"><b className="status status-amber">{formatNumber(days, 1)} dias</b><ArrowRight size={15} /></span></button>
                <button className="priority-row" onClick={() => setView("stock")}><span className="priority-icon red"><Package size={18} /></span><span><strong>Fertilizante abaixo do mínimo</strong><small>NPK · 120 kg em estoque · mínimo de 200 kg</small></span><span className="priority-trailing"><b className="status status-red">Repor</b><ArrowRight size={15} /></span></button>
                <button className="priority-row" onClick={() => setView("expiry")}><span className="priority-icon amber"><Clock3 size={18} /></span><span><strong>Um lote merece atenção</strong><small>Herbicida · 40 L · validade em 05/11/2026</small></span><span className="priority-trailing"><b className="status status-amber">15 dias</b><ArrowRight size={15} /></span></button>
                <div className="panel-foot"><ShieldCheck size={13} /> Recomendações com base nos registros da propriedade.</div>
              </section>
              <section className="consumption-panel"><div className="panel-title"><h4>Consumo de diesel</h4><span>Últimos 7 dias</span></div><div className="chart-number">420 <small>litros</small><span>60 L / dia, em média</span></div><ConsumptionChart /><button className="text-button" onClick={() => setView("diesel")}>Ver análise do produto <ArrowRight size={14} /></button></section>
            </div>
          </>}
          {view === "stock" && <section className="stock-panel"><div className="stock-toolbar"><h4>Seus insumos <span>6 produtos</span></h4><label className="search-field"><Search size={15} /><input aria-label="Buscar insumo" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar insumo…" /></label></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Lista de insumos, role para ver todas as colunas"><table><thead><tr><th>Produto</th><th>Saldo atual</th><th>Mínimo</th><th>Situação</th></tr></thead><tbody>{products.filter(p => p.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))).map(p => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.category}</small></td><td>{formatNumber(p.id === "diesel" ? diesel : p.quantity, 2)} {p.unit}</td><td>{p.minimum} {p.unit}</td><td><span className={`status ${p.id === "npk" ? "status-red" : p.id === "diesel" || p.id === "herbicide" ? "status-amber" : "status-green"}`}>{p.status}</span></td></tr>)}</tbody></table></div>{!products.some(p => p.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))) && <p className="empty-result">Nenhum produto encontrado. Tente outro nome.</p>}</section>}
          {view === "diesel" && <><div className="metrics three"><Metric label="Saldo disponível" value={`${formatNumber(diesel, 2)} L`} detail="Unidade: litros" icon={<Droplets />} /><Metric label="Consumo médio" value="60 L/dia" detail="30 dias de histórico fictício" icon={<ArrowDownLeft />} /><Metric label="Autonomia estimada" value={`${formatNumber(days, 1)} dias`} detail="Considerando o consumo médio" warning icon={<Clock3 />} /></div><div className="dashboard-grid"><section className="consumption-panel"><div className="panel-title"><h4>Consumo diário · Diesel S10</h4><span>15 a 21 out</span></div><ConsumptionChart detailed /><p className="chart-description">420 litros utilizados em 7 dias. Média de 60 litros por dia.</p></section><section className="recommendation"><span className="eyebrow">ENTENDA A RECOMENDAÇÃO</span><h4>Planeje o próximo abastecimento.</h4><p>Com {formatNumber(diesel, 2)} L disponíveis e consumo médio de 60 L por dia, a autonomia estimada é de {formatNumber(days, 1)} dias.</p><div className="formula">{formatNumber(diesel, 2)} L ÷ 60 L/dia = <strong>{formatNumber(days, 1)} dias</strong></div><small>Estimativa ilustrativa. Mudanças no consumo alteram esse prazo.</small></section></div></>}
          {view === "expiry" && <div className="expiry-panel"><div className="expiry-heading"><span className="priority-icon amber"><Clock3 size={23} /></span><div><span className="eyebrow">VENCIMENTO PRÓXIMO</span><h4>Herbicida · lote HB-026</h4><p>Um lote para conferir no seu planejamento.</p></div><span className="status status-amber">15 dias restantes</span></div><div className="expiry-facts"><div><small>QUANTIDADE NO LOTE</small><strong>40 <span>litros</span></strong></div><div><small>DATA DE VALIDADE</small><strong>05/11/2026</strong></div><div><small>CONSUMO ATÉ A VALIDADE</small><strong>12 <span>litros estimados</span></strong></div></div><div className="expiry-note"><TriangleAlert size={20} /><p><strong>Parte desse lote pode não ser utilizada a tempo.</strong>Confira o planejamento de uso e as condições do produto. A recomendação não é aumentar o uso para evitar perdas.</p></div><p className="source-note">Premissa do exemplo: consumo médio de 0,8 L/dia × 15 dias. Registros de referência em 21/10/2026.</p></div>}
          <div className="demo-bottom"><span><span className="live-dot" /> Exemplo interativo · alterações temporárias</span><button onClick={reset}><RotateCcw size={12} /> Reiniciar dados</button></div>
        </div>
      </div>
    </div>
    <dialog ref={dialog} className="movement-dialog" aria-labelledby="movement-title" aria-describedby="movement-description" onClose={() => setConfirming(false)}>
      <div className="dialog-top"><span className="eyebrow">DEMONSTRAÇÃO</span><button aria-label="Fechar simulação" onClick={() => dialog.current?.close()}><X size={21} /></button></div>
      <h3 id="movement-title">{confirming ? "Confirme a retirada de exemplo" : "Simular retirada de diesel"}</h3>
      <p id="movement-description">Experimente como uma movimentação muda o saldo e a autonomia. Nada será salvo. O consumo médio histórico de referência permanece em 60 L/dia.</p>
      {confirming ? <dl className="movement-summary"><div><dt>Produto</dt><dd>Diesel S10</dd></div><div><dt>Retirada</dt><dd>{formatNumber(Number(quantity), 2)} L</dd></div><div><dt>Destino</dt><dd>Trator · exemplo</dd></div><div><dt>Saldo após a retirada</dt><dd>{formatNumber(diesel - Number(quantity), 2)} L</dd></div></dl> : <form onSubmit={e => { e.preventDefault(); if (!invalidQuantity) setConfirming(true); }}><label className="quantity-label" htmlFor="quantity">Quantidade em litros</label><input autoFocus id="quantity" type="number" min="0.01" step="0.01" max={diesel} value={quantity} onChange={e => setQuantity(e.target.value)} required /><small>Saldo disponível: {formatNumber(diesel, 2)} L.</small>{invalidQuantity && <p className="field-error">Informe uma quantidade maior que zero e até o saldo disponível.</p>}<button className="button button-green" type="submit" disabled={invalidQuantity}>Revisar retirada <ArrowRight size={16} /></button></form>}
      {confirming && <div className="confirm-actions"><button className="button button-green" onClick={saveMovement} disabled={invalidQuantity}><CircleCheck size={16} />Confirmar simulação</button><button className="button button-outline" onClick={() => setConfirming(false)}>Voltar</button></div>}
    </dialog>
  </div>;
}

function Metric({ label, value, detail, warning, icon }: { label: string; value: string; detail: string; warning?: boolean; icon: React.ReactNode }) {
  return <div className={`metric ${warning ? "metric-warning" : ""}`}><span className="metric-top">{label}{icon}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function ConsumptionChart({ detailed = false }: { detailed?: boolean }) {
  return <div className={`consumption-chart ${detailed ? "chart-detailed" : ""}`}>
    <div className="chart-bars" role="img" aria-label="Consumo de diesel nos últimos sete dias: 45, 75, 60, 30, 90, 50 e 70 litros.">{dailyConsumption.map((value, i) => <div className="chart-column" key={i}>{detailed && <span>{value}</span>}<i style={{ height: `${value}%` }} /><small>{15 + i}</small></div>)}</div>
    <details className="chart-data"><summary>Ver dados em tabela</summary><table><caption>Consumo de diesel · outubro de 2026</caption><thead><tr><th>Dia</th><th>Litros</th></tr></thead><tbody>{dailyConsumption.map((v, i) => <tr key={i}><td>{15 + i}/10</td><td>{v} L</td></tr>)}</tbody></table></details>
  </div>;
}
