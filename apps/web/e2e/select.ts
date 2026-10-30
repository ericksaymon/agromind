import type { Locator } from "@playwright/test";

/** Escolhe uma opção do componente Select (substitui selectOption do <select> nativo). */
export async function pick(trigger: Locator, value: string) {
  await trigger.click();
  await trigger.page().locator(`.ui-select-option[data-value="${value}"]`).click();
}
