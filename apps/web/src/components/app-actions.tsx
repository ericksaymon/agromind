"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { apiRequest } from "@/lib/auth-client";
import type { PropertySummary } from "../../../../packages/contracts/src/index";
export function LogoutButton() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="logout-action">
      <button
        disabled={busy || !ready}
        data-action-ready={ready}
        onClick={async () => {
          if (
            !window.dispatchEvent(
              new Event("agromind:before-navigation", { cancelable: true }),
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            await apiRequest("/api/auth/logout", {});
            window.dispatchEvent(new Event("agromind:discard-unsaved"));
            window.location.assign("/entrar");
          } catch {
            setError("Não foi possível sair. Tente novamente.");
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <LogOut size={16} />
        )}{" "}
        Sair da conta
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function PropertySelector({
  properties,
  activeId,
}: {
  properties: PropertySummary[];
  activeId: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="real-property-selector">
      <label htmlFor="active-property">PROPRIEDADE ATUAL</label>
      <select
        id="active-property"
        value={activeId}
        disabled={busy || !ready}
        onChange={async (e) => {
          if (
            !window.dispatchEvent(
              new Event("agromind:before-navigation", { cancelable: true }),
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            await apiRequest("/api/auth/active-property", {
              propertyId: e.target.value,
            });
            window.dispatchEvent(new Event("agromind:discard-unsaved"));
            window.location.reload();
          } catch {
            setError("Não foi possível trocar a propriedade.");
            setBusy(false);
          }
        }}
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Link href="/nova-propriedade">+ Criar propriedade</Link>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
