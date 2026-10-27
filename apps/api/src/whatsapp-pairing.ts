import { randomInt } from "node:crypto";
import { settings } from "./config";
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const whatsappPairingAvailable = () => settings.production || process.env.WHATSAPP_ALLOW_LOCAL_PAIRING === "true";
export function newWhatsappPairCode() { return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(""); }
export function parseWhatsappPairCode(text: string): string | null {
  const old = /^AGROMIND\s+([a-f0-9]{32})$/i.exec(text.trim());
  if (old) return old[1].toLowerCase();
  const short = /^(?:AGROMIND\s+)?([A-HJ-NP-Z2-9]{4})[-\s]?([A-HJ-NP-Z2-9]{4})$/i.exec(text.trim());
  return short ? (short[1] + short[2]).toLowerCase() : null;
}
