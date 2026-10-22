import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { OnboardingForm } from "@/components/onboarding-form";
import { requireAccount } from "@/lib/auth-server";
export const metadata = { title: "Sua propriedade | AgroMind" };
export default async function SetupPage() {
  const session = await requireAccount();
  if (!session.user.emailVerified) redirect("/verificar-email");
  if (session.property) redirect("/app");
  return <AuthFrame wide title="Vamos conhecer sua propriedade." description="Só os dados essenciais para preparar seu espaço de trabalho." label="CONFIGURAÇÃO INICIAL"><OnboardingForm userName={session.user.name} /></AuthFrame>;
}
