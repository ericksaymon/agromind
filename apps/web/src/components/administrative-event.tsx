export const administrativeLabels: Record<string, string> = {
  PROPERTY_CREATED: "Propriedade criada",
  PROPERTY_CHANGED: "Propriedade atualizada",
  CATEGORY_CREATED: "Categoria criada",
  CATEGORY_CHANGED: "Categoria atualizada",
  MEMBERSHIP_CHANGED: "Acesso alterado",
  INVITATION_CREATED: "Convite solicitado",
  INVITATION_RESENT: "Reenvio solicitado",
  INVITATION_REVOKED: "Convite revogado",
  INVITATION_ACCEPTED: "Convite aceito",
  PROFILE_CHANGED: "Nome atualizado",
  PASSWORD_CHANGED: "Senha alterada",
  SESSIONS_REVOKED: "Sessões encerradas",
  EMAIL_CHANGE_STARTED: "Troca de e-mail solicitada",
  EMAIL_CHANGE_CANCELED: "Troca de e-mail cancelada",
  EMAIL_CHANGED: "E-mail alterado",
};
const names: Record<string, string> = {
  name: "Nome",
  responsible: "Responsável",
  phone: "Telefone",
  timezone: "Fuso horário",
  archived: "Arquivamento",
};
const roles: Record<string, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  VIEWER: "Consulta",
  REMOVE: "Removido",
};
const show = (value: unknown) =>
  value === null
    ? "Não informado"
    : typeof value === "boolean"
      ? value
        ? "Sim"
        : "Não"
      : typeof value === "string"
        ? roles[value] || value
        : "—";
export function AdministrativeEventDetail({
  details,
}: {
  details: Record<string, unknown>;
}) {
  const before = details.before,
    after = details.after;
  if (typeof before === "string" && typeof after === "string")
    return (
      <p>
        {show(before)} → {show(after)}
      </p>
    );
  if (after && typeof after === "object") {
    const current = after as Record<string, unknown>,
      previous = (before || {}) as Record<string, unknown>;
    return (
      <dl>
        {Object.entries(current)
          .filter(([key]) => key in names)
          .map(([key, value]) => (
            <div key={key}>
              <dt>{names[key]}</dt>
              <dd>
                {show(previous[key])} → {show(value)}
              </dd>
            </div>
          ))}
      </dl>
    );
  }
  if (typeof details.name === "string") return <p>{details.name}</p>;
  if (typeof details.count === "number")
    return <p>{details.count} sessão(ões) encerrada(s).</p>;
  return null;
}
