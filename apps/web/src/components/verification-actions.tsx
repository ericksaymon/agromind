"use client";
import { useState } from "react";
import { ArrowRight, LoaderCircle, Mail, RotateCcw } from "lucide-react";
import { apiRequest, continueAfterLogin } from "@/lib/auth-client";
export function VerificationActions() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function resend() {
    setBusy(true); setError(""); setMessage("");
    try { await apiRequest("/api/auth/resend-verification", {}); setMessage("Um novo e-mail foi enviado. Use o link mais recente."); }
    catch (e) { setError(e instanceof Error ? e.message : "Tente novamente."); }
    finally { setBusy(false); }
  }
  async function check() { setBusy(true); setError(""); try { const s = await apiRequest<{ user: { emailVerified: boolean } }>("/api/auth/me"); if (!s.user.emailVerified) setError("Seu e-mail ainda não foi confirmado. Abra a mensagem recebida e confirme o endereço."); else await continueAfterLogin(); } catch { setError("Não foi possível conferir agora. Tente novamente."); } finally { setBusy(false); } }
  return <div className="verification-actions">{message && <p className="form-success" role="status"><Mail size={17} />{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-green auth-submit" onClick={check} disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <>Já confirmei meu e-mail <ArrowRight size={17} /></>}</button><button className="text-button resend-button" onClick={resend} disabled={busy}><RotateCcw size={14} /> Reenviar e-mail de confirmação</button><button className="auth-other-account" onClick={async () => { try { await apiRequest("/api/auth/logout", {}); window.location.assign("/entrar"); } catch { setError("Não foi possível sair. Tente novamente."); } }}>Usar outra conta</button></div>;
}
