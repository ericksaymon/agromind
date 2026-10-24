"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, LogOut, Plus, Sprout, UserRound } from "lucide-react";
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
    <div className="shell-property">
      <Sprout size={18} aria-hidden="true" />
      <label htmlFor="active-property">Propriedade atual</label>
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
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ProfileMenu({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && el.contains(e.target as Node)) return;
      el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const first = name.split(" ")[0];
  const closeMenu = () => ref.current?.removeAttribute("open");
  return (
    <details className="profile-menu" ref={ref}>
      <summary aria-label={`${first}, abrir menu da conta`}>
        <span aria-hidden="true" data-initials={name.slice(0, 2).toUpperCase()} />
        <b>{first}</b>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="profile-menu-panel">
        <div className="profile-menu-id">
          <strong>{name}</strong>
          <small>{email}</small>
          <em>{role}</em>
        </div>
        <Link href="/conta" onClick={closeMenu}>
          <UserRound size={16} /> Minha conta e sessões
        </Link>
        <Link href="/nova-propriedade" onClick={closeMenu}>
          <Plus size={16} /> Criar propriedade
        </Link>
        <LogoutButton />
      </div>
    </details>
  );
}
