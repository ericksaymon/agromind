import { AuthFrame } from "@/components/auth-frame";
import { AuthForm } from "@/components/auth-form";
import { redirectSignedIn } from "@/lib/auth-server";
export const metadata = { title: "Criar conta | AgroMind" };
export default async function RegisterPage() {
  await redirectSignedIn();
  return <AuthFrame title="Seu próximo passo começa aqui." description="Crie seu acesso. Depois, vamos conhecer sua propriedade." label="VAMOS COMEÇAR"><AuthForm mode="register" /></AuthFrame>;
}
