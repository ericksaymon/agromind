import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth-server";
import { NewPropertyForm } from "@/components/settings-workspace";
export default async function Page() {
  const s = await requireAccount();
  if (!s.user.emailVerified) redirect("/verificar-email");
  return (
    <main className="account-page">
      <NewPropertyForm name={s.user.name} />
      <Link href="/conta">Minha conta</Link>
    </main>
  );
}
