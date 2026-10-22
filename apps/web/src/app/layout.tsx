import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "./globals.css";
import "./auth.css";
import "./stock.css";
import "./analysis.css";
import "./intelligence.css";

export const metadata: Metadata = {
  title: "AgroMind | A inteligência da sua propriedade",
  description: "Conheça o AgroMind: estoque rural, consumo e vencimentos em um só painel. Explore a demonstração e a proposta de gestão pelo WhatsApp.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
