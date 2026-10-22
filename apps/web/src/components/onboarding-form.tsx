"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, FileSpreadsheet, LoaderCircle, Package, Sprout, TriangleAlert } from "lucide-react";
import { apiRequest } from "@/lib/auth-client";
import { ImportDataGuide } from "@/components/import-data-guide";

export function OnboardingForm({ userName }: { userName: string }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [step, setStep] = useState(1), [name, setName] = useState(""), [responsible, setResponsible] = useState(userName);
  const [timezone, setTimezone] = useState("America/Porto_Velho"), [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"IMPORT" | "MANUAL">("IMPORT"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (step === 1) { setStep(2); return; }
    setBusy(true);
    try {
      await apiRequest("/api/properties", { name: name.trim(), responsible: responsible.trim(), timezone, phone, startMethod: method });
      window.location.assign(method === "IMPORT" ? "/app/importar" : "/app/estoque");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <><p>Recebeu um convite? <a href="/convite">Aceitar acesso a uma propriedade existente</a> · <a href="/conta">Minha conta</a></p><ol className="onboarding-progress" aria-label="Etapas da configuração"><li aria-current={step === 1 ? "step" : undefined} className={step >= 1 ? "current" : ""}><span>{step > 1 ? <Check size={14} /> : "1"}</span> Sua propriedade</li><li aria-current={step === 2 ? "step" : undefined} className={step === 2 ? "current" : ""}><span>2</span> Seu ponto de partida</li></ol><form className="auth-form onboarding-form" onSubmit={submit} inert={!hydrated} data-form-ready={hydrated} aria-busy={busy}>
    {step === 1 ? <><label htmlFor="property-name">Nome da propriedade<input id="property-name" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={120} autoComplete="off" required placeholder="Ex.: Fazenda Boa Vista" /></label><label htmlFor="property-responsible">Responsável<input id="property-responsible" value={responsible} onChange={e => setResponsible(e.target.value)} minLength={2} maxLength={120} autoComplete="off" required /></label><div className="form-two-columns"><label htmlFor="property-timezone">Fuso horário<select id="property-timezone" value={timezone} onChange={e => setTimezone(e.target.value)}><option value="America/Porto_Velho">Rondônia · UTC−4</option><option value="America/Cuiaba">Mato Grosso · UTC−4</option><option value="America/Sao_Paulo">Brasília · UTC−3</option><option value="America/Manaus">Amazonas · UTC−4</option><option value="America/Rio_Branco">Acre · UTC−5</option><option value="America/Bahia">Bahia · UTC−3</option></select></label><label htmlFor="property-phone">Telefone <span className="optional-label">opcional</span><input id="property-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} autoComplete="off" placeholder="(69) 99999-9999" /></label></div><p className="form-helper"><Sprout size={16} /> O fuso define como as datas da propriedade serão apresentadas.</p></> : <><div className="property-review"><span><Sprout size={20} /></span><p><strong>{name}</strong><small>Responsável: {responsible}</small></p><button type="button" onClick={() => setStep(1)}>Editar</button></div><fieldset className="start-options"><legend>Como você prefere começar o estoque?</legend><label className={method === "IMPORT" ? "selected" : ""}><input type="radio" name="start-method" value="IMPORT" checked={method === "IMPORT"} onChange={() => setMethod("IMPORT")} /><FileSpreadsheet size={24} /><span><strong>Trazer uma planilha</strong><small>Já tenho meus insumos organizados em um arquivo.</small></span></label><label className={method === "MANUAL" ? "selected" : ""}><input type="radio" name="start-method" value="MANUAL" checked={method === "MANUAL"} onChange={() => setMethod("MANUAL")} /><Package size={24} /><span><strong>Começar pelo cadastro</strong><small>Prefiro organizar os produtos aos poucos.</small></span></label></fieldset><p className="form-helper">Sua escolha será salva. Na próxima tela, você poderá importar uma planilha com conferência ou cadastrar seu primeiro insumo.</p></>}
    {step === 2 && <ImportDataGuide />}
    {error && <div className="form-error" role="alert"><TriangleAlert size={17} />{error}</div>}
    <button className="button button-green auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" /> Salvando…</> : <>{step === 1 ? "Continuar" : "Concluir configuração"}<ArrowRight size={17} /></>}</button>
    {step === 2 && <button className="onboarding-back" type="button" disabled={busy} onClick={() => setStep(1)}>Voltar para os dados da propriedade</button>}
  </form></>;
}
