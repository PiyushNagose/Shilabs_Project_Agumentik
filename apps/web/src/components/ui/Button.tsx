import type React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  iconOnly?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  className,
  type = "button",
  ...props
}: ButtonProps): React.JSX.Element {
  const classes = [
    "ui-button",
    `ui-button-${variant}`,
    `ui-button-${size}`,
    iconOnly ? "ui-button-icon" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} type={type} {...props} />;
}
