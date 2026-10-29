// Boas-vindas do primeiro acesso: o onboarding deixa um recado aqui e o modal (components/welcome-modal.tsx) o mostra uma vez.
export const WELCOME_KEY = "agromind.welcome";
export type WelcomeNote = { name: string; property: string; method: "IMPORT" | "MANUAL" };

export function saveWelcome(note: WelcomeNote) { try { localStorage.setItem(WELCOME_KEY, JSON.stringify(note)); } catch { /* sem armazenamento: só não há boas-vindas */ } }
export function takeWelcome(): WelcomeNote | null {
  try {
    const raw = localStorage.getItem(WELCOME_KEY);
    if (!raw) return null;
    localStorage.removeItem(WELCOME_KEY);
    const note = JSON.parse(raw) as Partial<WelcomeNote>;
    return typeof note.property === "string" && (note.method === "IMPORT" || note.method === "MANUAL") ? { name: String(note.name ?? ""), property: note.property, method: note.method } : null;
  } catch { return null; }
}
export const firstName = (full: string) => { const word = full.trim().split(/\s+/)[0] ?? ""; return word.length > 1 ? word : ""; };
