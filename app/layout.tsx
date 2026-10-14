import type { Metadata } from "next";
import "./globals.css";
import { SHOW_CM } from "@/lib/features";

export const metadata: Metadata = SHOW_CM
  ? {
      title: "Test Contractor Demo App",
      description:
        "Explore contractor product availability across countries, entities, and products via Remote's partner API",
    }
  : {
      title: "Global Payroll Test App",
      description: "Global Payroll coverage across countries via Remote's partner API",
    };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
