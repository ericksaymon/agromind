import { AuthFrame } from "@/components/auth-frame";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Nova senha | AgroMind", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function ResetPage() {
  return <AuthFrame title="Uma nova senha para continuar." description="Escolha uma senha que você ainda não utiliza em outros serviços." label="RECUPERE SEU ACESSO"><AuthForm mode="reset" /></AuthFrame>;
}
