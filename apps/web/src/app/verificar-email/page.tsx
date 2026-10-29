import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { AuthFrame } from "@/components/auth-frame";
import { VerificationActions } from "@/components/verification-actions";
import { requireAccount } from "@/lib/auth-server";
export const metadata = { title: "Confira seu e-mail | AgroMind" };
export default async function VerifyPage() {
  const session = await requireAccount();
  const dev = process.env.NODE_ENV !== "production";
  if (session.user.emailVerified && !dev) redirect(session.property ? "/app" : "/configuracao-inicial");
  return <AuthFrame title="Confira sua caixa de entrada." description="Antes de configurar a propriedade, confirme que esse e-mail é seu." label="SEU ACESSO ESTÁ QUASE PRONTO"><div className="verification-box"><Mail size={25} /><p>Procure a mensagem do AgroMind enviada para<strong>{session.user.email}</strong>{dev && <small>Ambiente de desenvolvimento: nenhum e-mail é enviado e a conta já está confirmada. Basta continuar.</small>}<small>O link vale por 24 horas. Confira também a pasta de spam. Se o envio falhou, você pode solicitar um novo abaixo.</small></p></div><VerificationActions /></AuthFrame>;
}
