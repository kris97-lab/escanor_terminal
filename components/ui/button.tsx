"use client";

import * as React from "react";

import styles from "./button.module.css";

type ButtonVariant = "default" | "outline" | "ghost";
type ButtonSize = "sm" | "default" | "lg";

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const variantClassMap: Record<ButtonVariant, string> = {
  default: styles.default,
  outline: styles.outline,
  ghost: styles.ghost,
};

const sizeClassMap: Record<ButtonSize, string | undefined> = {
  sm: styles.sm,
  default: undefined,
  lg: styles.lg,
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", block = false, ...props }, ref) => {
    const classes = cn(
      styles.button,
      variantClassMap[variant],
      sizeClassMap[size],
      block ? styles.block : undefined,
      className,
    );

    return <button ref={ref} className={classes} {...props} />;
  },
);
Button.displayName = "Button";
