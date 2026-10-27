"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, MessageCircle, ShieldCheck, Unplug } from "lucide-react";
import { apiRequest } from "@/lib/auth-client";
type State = { connection: { propertyId: string; propertyName: string | null; lastDigits: string; connectedAt: string; lastMessageAt: string; access: boolean } | null; pairingAvailable: boolean; pairingUrl: string; transportReady: boolean; businessPhone: string; latestReply: { status: string; errorCode: string | null; updatedAt: string } | null };
type Code = { shortCode: string; message: string; expiresAt: string; url: string };
export function WhatsappWorkspace({ properties, activeId }: { properties: { id: string; name: string }[]; activeId: string }) {
  const [state, setState] = useState<State | null>(null), [code, setCode] = useState<Code | null>(null), [propertyId, setPropertyId] = useState(activeId);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const load = () => apiRequest<State>("/api/account/whatsapp").then(value => { if (live) { setState(value); setError(""); } }).catch(e => { if (live) { setState(null); setCode(null); setError(e.message); } });
    void load(); const poll = setInterval(() => { setNow(Date.now()); void load(); }, 4000);
    return () => { live = false; clearInterval(poll); };
  }, []);
  useEffect(() => { if (code && state?.connection?.propertyId === propertyId && new Date(state.connection.connectedAt).getTime() > new Date(code.expiresAt).getTime() - 600_000) setCode(null); }, [code, state, propertyId]);
  const connected = state?.connection;
  const expired = !!code && new Date(code.expiresAt).getTime() <= now;
  async function generate() {
    setBusy(true); setError(""); setNotice("");
    try { setCode(await apiRequest<Code>("/api/account/whatsapp/code", { propertyId })); setNow(Date.now()); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError("");
    try { await apiRequest("/api/account/whatsapp/disconnect", {}); setCode(null); setState(await apiRequest<State>("/api/account/whatsapp")); setNotice("WhatsApp desconectado. Nenhuma nova consulta terá acesso aos seus dados."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const statuses: Record<string, string> = { QUEUED: "Aguardando envio", SENDING: "Enviando", ACCEPTED: "Aceita pela Meta; entrega ainda não confirmada", SENT: "Enviada", DELIVERED: "Entregue", READ: "Lida", FAILED: "Falha no envio", UNKNOWN: "Envio sem confirmação. Faça uma nova pergunta.", CANCELED: "Envio cancelado" };
  return <div className="stock-workspace whatsapp-workspace">
    <header className="stock-page-heading"><div><span className="eyebrow">SUA PROPRIEDADE NA CONVERSA</span><h1>Assistente no WhatsApp</h1><p>Consulte estoque, validade e autonomia pelo seu telefone, com os mesmos dados do painel.</p></div><MessageCircle size={36} aria-hidden="true" /></header>
    {error && <p className="stock-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!state && !error && <p role="status">Carregando sua conexão…</p>}
    {state && <div className="whatsapp-grid"><section className="stock-card whatsapp-connection" aria-labelledby="connection-title">
      <span className="whatsapp-status"><CheckCircle2 size={17} aria-hidden="true" />{connected?.access ? "WhatsApp conectado" : connected ? "Acesso à propriedade revogado" : "Conecte seu telefone"}</span>
      <h2 id="connection-title">{connected?.access ? connected.propertyName : "Uma conexão, só sua"}</h2>
      {connected && <><p>Telefone com final <strong>{connected.lastDigits}</strong>. {connected.access ? "Suas perguntas usam a propriedade acima, mesmo quando você navega por outra no painel." : "As consultas estão bloqueadas. Desconecte ou escolha uma propriedade à qual tenha acesso."}</p><p className="whatsapp-small">Última mensagem: {new Date(connected.lastMessageAt).toLocaleString("pt-BR")}</p><button type="button" className="stock-secondary" disabled={busy} onClick={() => void disconnect()}><Unplug size={16} /> Desconectar WhatsApp</button></>}
      {!state.pairingAvailable && <p className="whatsapp-note" role="status">O WhatsApp real está conectado ao AgroMind publicado. <a href={state.pairingUrl}>Abra o Assistente no site publicado para conectar seu telefone.</a> Sua conta e seus dados locais são separados.</p>}
      {state.pairingAvailable && !state.transportReady && <p className="whatsapp-note" role="status">O envio de respostas está aguardando configuração. Você pode vincular seu telefone e acompanhar a conexão aqui.</p>}
      <label className="whatsapp-label" htmlFor="whatsapp-property">Propriedade para as consultas</label>
      <select id="whatsapp-property" value={propertyId} disabled={busy} onChange={e => { setPropertyId(e.target.value); setCode(null); }}>{properties.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
      <p className="whatsapp-small">Cada conta conecta um telefone a uma propriedade por vez. Um novo vínculo substitui o anterior somente após sua confirmação pelo WhatsApp.</p>
      {!code && <button className="stock-primary" type="button" disabled={busy || !state.businessPhone || !state.pairingAvailable} onClick={() => void generate()}>{busy ? "Preparando…" : connected ? "Gerar código para trocar conexão" : "Conectar WhatsApp"}</button>}
      {code && <div className="whatsapp-code"><h3>{expired ? "Este código expirou" : "Envie o código pelo seu WhatsApp"}</h3><p>Use o telefone que você quer conectar. O código vale por dez minutos e só pode ser usado uma vez. Não compartilhe.</p>{!expired && <><code>{code.shortCode}</code><div className="stock-actions"><a className="stock-primary" href={code.url} target="_blank" rel="noopener noreferrer">Abrir WhatsApp <ExternalLink size={15} /></a><button className="stock-secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(code.shortCode); setNotice("Código copiado."); } catch { setNotice("Selecione e copie o código exibido."); } }}><Copy size={15} /> Copiar código</button></div><p className="whatsapp-small" role="status">Aguardando sua mensagem. A conexão será atualizada automaticamente.</p></>}<button className="stock-secondary" disabled={busy} onClick={() => void generate()}>Gerar outro código</button></div>}
      {state.latestReply && <p className="whatsapp-small">Última resposta: {statuses[state.latestReply.status] || "Em processamento"}</p>}
    </section><aside className="stock-card whatsapp-guide" aria-label="Como usar o assistente"><ShieldCheck size={25} aria-hidden="true" /><h2>Do painel para o campo</h2><ol><li>Escolha a propriedade e gere seu código.</li><li>Abra o WhatsApp e envie a mensagem pronta.</li><li>Volte aqui para conferir o vínculo e comece a perguntar.</li></ol><h3>Perguntas para começar</h3><ul><li>Quanto diesel temos?</li><li>O que está abaixo do mínimo?</li><li>O que está perto de vencer?</li><li>Qual a autonomia do diesel?</li></ul><p>Consultas por texto. Se houver produtos parecidos, informe o nome completo. Sem histórico suficiente, a autonomia fica indisponível.</p><p>Movimentações e áudios ainda não estão disponíveis. Suas permissões são conferidas em cada consulta e antes do envio.</p></aside></div>}
  </div>;
}
