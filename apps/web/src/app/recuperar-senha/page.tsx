import { AuthFrame } from "@/components/auth-frame";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Recuperar acesso | AgroMind" };
export default function ForgotPage() {
  return <AuthFrame title="Vamos recuperar seu acesso." description="Informe o e-mail da conta para solicitar um link de redefinição." label="RECUPERAÇÃO DE ACESSO"><AuthForm mode="forgot" /></AuthFrame>;
}
