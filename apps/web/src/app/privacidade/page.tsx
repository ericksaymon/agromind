import { LegalPage } from "@/components/legal-page";
export const metadata = { title: "Privacidade | AgroMind" };
export const dynamic = "force-dynamic";
export default function PrivacyPage() { return <LegalPage privacy production={process.env.APP_ENV === "production"} />; }
