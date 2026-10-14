import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Remote API Test Lab",
  description:
    "Test Remote Partner API onboarding flows (contractor products and Global Payroll) against the sandboxes",
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
