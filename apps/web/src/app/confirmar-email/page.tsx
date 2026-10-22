import { AuthFrame } from "@/components/auth-frame";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Confirmar e-mail | AgroMind", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function ConfirmPage() {
  return <AuthFrame title="Vamos confirmar seu e-mail." description="Essa etapa ajuda a manter seu acesso protegido." label="FALTA SÓ CONFIRMAR"><AuthForm mode="confirm" /></AuthFrame>;
}
