import type { Metadata } from "next";
import { Outfit, Syne } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const syne = Syne({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-syne" });

export const metadata: Metadata = {
  title: "Synapse.gg | Collegiate Trivia Arena",
  description: "A competitive multiplayer game for students at Manipal Institute of Technology (MIT).",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${syne.variable} ${outfit.variable}`}>
      <body className={`${outfit.className} bg-slate-950 text-white min-h-screen selection:bg-teal-400/40 selection:text-white`}>
        {children}
      </body>
    </html>
  );
}
