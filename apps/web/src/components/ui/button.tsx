import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Variants intentionally flattened to match /health's monochrome ghost-button
// look: default/outline/secondary all render as the same neutral bordered
// chip (bg-secondary, border-input, muted text) — health has no colorful
// "primary" CTA anywhere, every action button looks the same.
const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "border border-input bg-secondary text-foreground hover:bg-accent hover:text-accent-foreground",
                destructive:
                    "border border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10",
                outline:
                    "border border-input bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                secondary:
                    "border border-input bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
                ghost: "hover:bg-accent hover:text-accent-foreground",
                link: "text-foreground underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9 px-4",
                sm: "h-8 rounded-md px-3.5",
                lg: "h-10 rounded-md px-6 text-sm",
                icon: "h-8 w-8",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";

export { Button, buttonVariants };
