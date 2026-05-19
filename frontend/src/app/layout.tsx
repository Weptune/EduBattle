import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MIT Ranked Subject Battler",
  description: "A competitive multiplayer game for students at Manipal Institute of Technology (MIT).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${outfit.className} bg-slate-950 text-white min-h-screen selection:bg-fuchsia-500 selection:text-white`}>
        {children}
      </body>
    </html>
  );
}
