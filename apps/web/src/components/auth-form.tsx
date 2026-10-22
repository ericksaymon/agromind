"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleCheck, Eye, EyeOff, LoaderCircle, Mail, TriangleAlert } from "lucide-react";
import { apiRequest, continueAfterLogin } from "@/lib/auth-client";

type Mode = "login" | "register" | "forgot" | "reset" | "confirm";
export function AuthForm({ mode }: { mode: Mode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState(false);
  const [show, setShow] = useState(false), [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const capturedMode = useRef<Mode | null>(null);
  const [tokenReady, setTokenReady] = useState(mode !== "reset" && mode !== "confirm");
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    setHydrated(true);
    if (capturedMode.current === mode) return;
    capturedMode.current = mode;
    if (mode === "reset" || mode === "confirm") {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      setToken(value); setTokenReady(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [mode]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if ((mode === "register" || mode === "reset") && (!/[0-9]/.test(password) || !/[a-zA-ZÀ-ÿ]/.test(password))) { setError("Sua senha precisa ter letras e números."); return; }
    if (mode === "reset" && password !== confirmation) { setError("As senhas precisam ser iguais."); return; }
    setBusy(true);
    try {
      if (mode === "login") { await apiRequest("/api/auth/login", { email: email.trim(), password }); await continueAfterLogin(); }
      if (mode === "register") { await apiRequest("/api/auth/register", { name: name.trim(), email: email.trim(), password, terms: true }); window.location.assign("/verificar-email"); }
      if (mode === "forgot") { await apiRequest("/api/auth/forgot-password", { email: email.trim() }); setSuccess(true); }
      if (mode === "reset") { await apiRequest("/api/auth/reset-password", { token, password }); setSuccess(true); }
      if (mode === "confirm") { await apiRequest("/api/auth/verify-email", { token }); setSuccess(true); }
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente."); }
    finally { setBusy(false); }
  }
  if (success) return <div className="auth-success" role="status"><span><CircleCheck size={25} /></span><h2>{mode === "forgot" ? "Confira seu e-mail" : mode === "reset" ? "Sua senha foi atualizada" : "E-mail confirmado"}</h2><p>{mode === "forgot" ? "Se houver uma conta com esse endereço, enviamos um link válido por 30 minutos. Confira também o spam." : mode === "reset" ? "Entre com sua nova senha. As sessões anteriores foram encerradas para proteger sua conta." : "Agora você pode configurar sua propriedade e preparar seu espaço."}</p><Link className="button button-green" href={mode === "confirm" ? "/configuracao-inicial" : "/entrar"}>{mode === "confirm" ? "Continuar" : "Voltar para entrar"}<ArrowRight size={16} /></Link></div>;
  if (!tokenReady) return <p className="auth-wait" role="status"><LoaderCircle className="spin" size={17} /> Conferindo seu link…</p>;
  if ((mode === "reset" || mode === "confirm") && !token) return <div className="auth-invalid"><TriangleAlert size={25} /><h2>Precisamos de um link válido</h2><p>Abra o link recebido no e-mail. Se ele expirou, solicite um novo.</p><Link className="button button-green" href={mode === "reset" ? "/recuperar-senha" : "/verificar-email"}>Solicitar outro link <ArrowRight size={16} /></Link></div>;
  return <form onSubmit={submit} className="auth-form" inert={!hydrated} data-form-ready={hydrated} aria-busy={busy}>
    {mode === "register" && <label htmlFor="auth-name">Seu nome<input id="auth-name" name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} placeholder="Como podemos chamar você?" /></label>}
    {["login", "register", "forgot"].includes(mode) && <label htmlFor="auth-email">E-mail<input id="auth-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required placeholder="voce@exemplo.com" /></label>}
    {["login", "register", "reset"].includes(mode) && <label htmlFor="auth-password"><span className="field-label-row">{mode === "reset" ? "Nova senha" : "Senha"}{mode === "login" && <Link href="/recuperar-senha">Esqueci minha senha</Link>}</span><span className="password-input"><input id="auth-password" aria-label={mode === "reset" ? "Nova senha" : "Senha"} name="password" type={show ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "login" ? "Sua senha" : "Pelo menos 8 caracteres"} /><button type="button" aria-label={show ? "Ocultar senha" : "Mostrar senha"} aria-pressed={show} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>{mode !== "login" && <small>Use de 8 a 128 caracteres, com letras e números.</small>}</label>}
    {mode === "reset" && <label htmlFor="auth-confirm">Confirme a nova senha<input id="auth-confirm" type="password" name="confirmation" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={8} maxLength={128} placeholder="Repita sua nova senha" /></label>}
    {mode === "register" && <label className="terms-check"><input type="checkbox" name="terms" required /><span>Li e aceito os <Link href="/termos" target="_blank">termos de uso</Link> e a <Link href="/privacidade" target="_blank">política de privacidade</Link> deste ambiente de desenvolvimento.</span></label>}
    {mode === "confirm" && <div className="confirm-mail-note"><Mail size={22} /><p>Confirme que você solicitou a criação desta conta para validar seu endereço de e-mail.</p></div>}
    {error && <div className="form-error" role="alert"><TriangleAlert size={17} /><span>{error}</span></div>}
    <button className="button button-green auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Aguarde…</> : <>{({ login: "Entrar na minha conta", register: "Criar minha conta", forgot: "Enviar link de recuperação", reset: "Salvar nova senha", confirm: "Confirmar meu e-mail" })[mode]}{mode === "confirm" ? <Check size={17} /> : <ArrowRight size={17} />}</>}</button>
    {mode === "login" && <p className="auth-switch">Ainda não tem conta? <Link href="/criar-conta">Comece por aqui</Link></p>}
    {mode === "register" && <p className="auth-switch">Já tem uma conta? <Link href="/entrar">Entrar</Link></p>}
    {mode === "forgot" && <p className="auth-switch">Lembrou sua senha? <Link href="/entrar">Voltar para entrar</Link></p>}
    {mode === "confirm" && error && <p className="auth-switch"><Link href="/verificar-email">Solicitar novo e-mail</Link></p>}
    {mode === "reset" && error && <p className="auth-switch"><Link href="/recuperar-senha">Solicitar outro link</Link></p>}
  </form>;
}
