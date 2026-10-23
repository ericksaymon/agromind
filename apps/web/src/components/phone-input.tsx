"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";

function formatPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const number = digits.slice(2);
  const split = number.length > 8 ? 5 : 4;
  return `(${digits.slice(0, 2)}) ${number.slice(0, split)}${number.length > split ? `-${number.slice(split)}` : ""}`;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & {
  value?: string;
  defaultValue?: string;
};

export function PhoneInput({ value, defaultValue = "", onChange, ...props }: Props) {
  const [internal, setInternal] = useState(() => formatPhone(defaultValue));
  const input = useRef<HTMLInputElement>(null);
  return <input {...props} ref={input} type="tel" inputMode="tel" autoComplete="tel-national"
    placeholder="(69) 99999-9999" pattern="\([0-9]{2}\) [0-9]{4,5}-[0-9]{4}"
    title="Informe o DDD e o telefone com 10 ou 11 dígitos."
    value={value === undefined ? internal : formatPhone(value)}
    onChange={event => {
      const raw = event.target.value;
      let digitCount = raw.slice(0, event.target.selectionStart ?? raw.length).replace(/\D/g, "").length;
      let formatted = formatPhone(raw);
      // Deleting a separator also removes the preceding digit, so Backspace never gets stuck.
      const previous = value === undefined ? internal : formatPhone(value);
      if (formatted === previous && (event.nativeEvent as InputEvent).inputType === "deleteContentBackward" && digitCount > 0) {
        const digits = raw.replace(/\D/g, "");
        formatted = formatPhone(digits.slice(0, digitCount - 1) + digits.slice(digitCount));
        digitCount--;
      }
      if (/^\D*55/.test(raw) && raw.replace(/\D/g, "").length >= 12) digitCount = Math.max(0, digitCount - 2);
      event.target.value = formatted;
      setInternal(formatted);
      onChange?.(event);
      const position = digitCount === 0 ? 0 : [...formatted].reduce((state, char, index) => {
        if (/\d/.test(char) && state.count < digitCount) return { count: state.count + 1, position: index + 1 };
        return state;
      }, { count: 0, position: 0 }).position;
      requestAnimationFrame(() => {
        if (input.current === document.activeElement) input.current?.setSelectionRange(position, position);
      });
    }} />;
}
