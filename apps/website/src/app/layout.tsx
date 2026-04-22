import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lyra",
  description:
    "Lyra lives in your menu bar and automatically detects every development server running on your machine. See what's on which port, kill processes, open them in your browser, and stay organized — without ever opening a terminal.",
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
