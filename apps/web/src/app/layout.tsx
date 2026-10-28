import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "./globals.css";
import "./auth.css";
import "./shell.css";
import "./stock.css";
import "./analysis.css";
import "./intelligence.css";
import "./settings.css";
import { EnterReveal } from "@/components/enter-reveal";
import { ENTER_FLAG, ENTER_FLAG_TTL } from "@/lib/enter-app";

export const metadata: Metadata = {
  title: "AgroMind | A inteligência da sua propriedade",
  description: "Conheça o AgroMind: estoque rural, consumo e vencimentos em um só painel. Explore a demonstração e a proposta de gestão pelo WhatsApp.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // O script roda antes da primeira pintura: se acabamos de entrar pelo login, a página já abre coberta (ver EnterReveal).
  const cover = `try{var t=+sessionStorage.getItem(${JSON.stringify(ENTER_FLAG)});if(t&&Date.now()-t<${ENTER_FLAG_TTL})document.documentElement.classList.add("enter-cover")}catch(e){}`;
  return <html lang="pt-BR" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: cover }} /></head><body>{children}<EnterReveal /></body></html>;
}
