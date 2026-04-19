import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function Button({ children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className="inline-flex items-center justify-center rounded-full border border-stone-700 bg-stone-100 px-4 py-2 text-sm font-medium text-stone-950 transition hover:bg-white"
    >
      {children}
    </button>
  );
}
