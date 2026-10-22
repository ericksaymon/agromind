import { requireProperty } from "@/lib/auth-server";
import { SettingsWorkspace } from "@/components/settings-workspace";
export default async function Page() {
  const s = await requireProperty();
  return (
    <SettingsWorkspace
      key={s.property.id}
      property={s.property}
      userId={s.user.id}
    />
  );
}
