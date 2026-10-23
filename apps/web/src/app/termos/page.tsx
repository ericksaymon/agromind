import { LegalPage } from "@/components/legal-page";
export const metadata = { title: "Termos de uso | AgroMind" };
export const dynamic = "force-dynamic";
export default function TermsPage() { return <LegalPage production={process.env.APP_ENV === "production"} />; }
