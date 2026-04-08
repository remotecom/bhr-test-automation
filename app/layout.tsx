import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Test Contractor Demo App",
  description:
    "Explore contractor product availability across countries, entities, and products via Remote's partner API",
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
