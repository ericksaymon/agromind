// Entrada no app depois do login: o painel verde da tela de acesso cresce até cobrir a janela e o símbolo do AgroMind
// brota no centro. A navegação continua sendo `location.assign`; a animação acontece antes de sair da página.
// Estilos em auth.css (.enter-overlay).

/** `open`: tempo do painel até cobrir a tela; `total`: quando a navegação começa (ms). */
const TIMING = { open: 220, total: 440 };

export const ENTER_FLAG = "agromind.entering";
/** Depois deste tempo o sinal é considerado velho (aba fechada no meio do caminho) e a página abre normal. */
export const ENTER_FLAG_TTL = 10_000;

let entering = false;

const prefersReducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Anima a saída da tela de acesso e navega para `href`. Sem painel na tela ou com movimento reduzido, só navega. */
export function enterApp(href: string): void {
  if (entering) return;
  const panel = document.querySelector<HTMLElement>(".auth-page > .auth-story");
  if (!panel || prefersReducedMotion()) { window.location.assign(href); return; }
  entering = true;

  const prefetch = document.createElement("link");
  prefetch.rel = "prefetch"; prefetch.href = href; prefetch.as = "document";
  document.head.append(prefetch);

  const rect = panel.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = "enter-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.setProperty("--enter-top", `${rect.top}px`);
  overlay.style.setProperty("--enter-right", `${document.documentElement.clientWidth - rect.right}px`);
  overlay.style.setProperty("--enter-bottom", `${document.documentElement.clientHeight - rect.bottom}px`);
  overlay.style.setProperty("--enter-left", `${rect.left}px`);
  overlay.style.setProperty("--enter-open", `${TIMING.open}ms`);

  // A cópia do painel parte exatamente de onde o painel está, então não há salto quando ele passa a crescer.
  const copy = panel.cloneNode(true) as HTMLElement;
  copy.classList.add("enter-copy");
  const sprout = document.createElement("div");
  sprout.className = "enter-sprout";
  const glow = document.createElement("span");
  glow.className = "enter-glow";
  const symbol = document.createElement("img");
  symbol.src = "/brand/agromind-symbol.png"; symbol.alt = ""; symbol.width = 512; symbol.height = 541;
  sprout.append(glow, symbol);
  overlay.append(copy, sprout);
  document.body.append(overlay);
  document.querySelector(".auth-page")?.classList.add("is-leaving");
  document.body.setAttribute("aria-busy", "true");

  overlay.getBoundingClientRect(); // fixa o ponto de partida antes de abrir
  requestAnimationFrame(() => { document.documentElement.classList.add("is-entering"); overlay.classList.add("is-open"); });
  // A página nova lê este sinal e abre coberta pela mesma tela verde (components/enter-reveal.tsx), dissolvendo-a depois.
  window.setTimeout(() => {
    try { sessionStorage.setItem(ENTER_FLAG, String(Date.now())); } catch { /* sem sessionStorage: só o corte */ }
    window.location.assign(href);
  }, TIMING.total);

  // Voltar pelo navegador pode trazer esta página do cache já com a animação pronta: desfaz tudo.
  window.addEventListener("pageshow", (event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    overlay.remove(); prefetch.remove();
    document.querySelector(".auth-page")?.classList.remove("is-leaving");
    document.body.removeAttribute("aria-busy");
    document.documentElement.classList.remove("is-entering");
    try { sessionStorage.removeItem(ENTER_FLAG); } catch { /* ignora */ }
    entering = false;
  }, { once: true });
}
