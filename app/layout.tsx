import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "ShapeShifter — Vector & Motion Editor",
  description:
    "Draw vectors, refine path morphs, and animate Android assets with precise property tracks.",
};

// Canvas gestures are handled locally; the page keeps accessible browser zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster
            position="top-center"
            offset={56}
            mobileOffset={{ top: 56, left: 12, right: 12 }}
            gap={8}
            toastOptions={{
              classNames: {
                toast:
                  "!w-auto !max-w-[420px] !rounded-xl !border-0 !bg-foreground !px-3.5 !py-2.5 !text-[13px] !text-background !shadow-[0_8px_24px_-6px_rgb(0_0_0/0.35)] !gap-2.5 mx-auto",
                title: "!font-medium",
                description: "!text-[12px] !text-background/70",
                icon: "!size-4",
                error: "[&_[data-icon]]:!text-red-400",
                success: "[&_[data-icon]]:!text-emerald-400",
                warning: "[&_[data-icon]]:!text-amber-400",
                actionButton: "!bg-background !text-foreground !rounded-md",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
