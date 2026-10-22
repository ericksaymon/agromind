import { AuthFrame } from "@/components/auth-frame";
import { AuthForm } from "@/components/auth-form";
import { redirectSignedIn } from "@/lib/auth-server";
export const metadata = { title: "Entrar | AgroMind" };
export default async function LoginPage() {
  await redirectSignedIn();
  return <AuthFrame title="Bom ter você de volta." description="Entre para continuar cuidando da sua propriedade."><AuthForm mode="login" /></AuthFrame>;
}
