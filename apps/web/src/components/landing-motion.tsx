"use client";

import { useEffect } from "react";

/** Entradas pontuais: o conteúdo continua visível se JavaScript estiver desativado. */
export function LandingMotion() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pending = new Set(document.querySelectorAll(
      ".pain-grid > div, .section-copy, .chat-scene, .section-heading, " +
      ".steps article, .import-preview, .decision-example, " +
      ".principles-band .container, .faq-list details, " +
      ".closing-section .container, .footer-grid > div",
    ));
    const active = new Set<Animation>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || preference.matches) continue;
        observer.unobserve(entry.target);
        pending.delete(entry.target);
        const animation = entry.target.animate(
          [{ opacity: 0.25, transform: "translateY(16px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 550, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
        active.add(animation);
        animation.finished.then(() => active.delete(animation), () => active.delete(animation));
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -20px 0px" });

    function syncPreference() {
      if (preference.matches) {
        observer.disconnect();
        active.forEach(animation => animation.cancel());
        active.clear();
      } else {
        pending.forEach(element => observer.observe(element));
      }
    }

    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", syncPreference);
      active.forEach(animation => animation.cancel());
    };
  }, []);

  return null;
}
