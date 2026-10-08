import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import type { Metadata, Viewport } from "next";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

const title = "Pathshift — Vector & Motion Editor";
const description =
  "Draw vectors. Make them move. Create icons, refine path morphs, and animate Android assets in your browser with SVG and AnimatedVectorDrawable exports.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "Pathshift",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
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
      className={cn("dark antialiased", fontMono.variable, "font-sans", geist.variable)}
      style={{ colorScheme: "dark" }}
    >
      <head>
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster
            position="top-center"
            offset={56}
            mobileOffset={{ top: 56, left: 12, right: 12 }}
            gap={8}
            style={{ width: "min(420px, calc(100vw - 24px))" }}
            toastOptions={{
              classNames: {
                toast:
                  "!w-full !max-w-full !rounded-lg !border-border !bg-popover !px-3 !py-2.5 !text-[13px] !text-popover-foreground !shadow-md !gap-2.5 [&_[data-content]]:min-w-0 [&_[data-content]]:flex-1",
                title: "!font-medium !whitespace-normal [overflow-wrap:anywhere]",
                description:
                  "!text-[12px] !text-muted-foreground !whitespace-normal [overflow-wrap:anywhere]",
                icon: "!size-4 !shrink-0",
                error: "[&_[data-icon]]:!text-red-400",
                success: "[&_[data-icon]]:!text-emerald-400",
                warning: "[&_[data-icon]]:!text-amber-400",
                actionButton: "!shrink-0 !bg-primary !text-primary-foreground !rounded-md",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
