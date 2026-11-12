import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import "./globals.css";

const switzer = localFont({
  src: [
    { path: "../fonts/Switzer-300.woff2", weight: "300" },
    { path: "../fonts/Switzer-400.woff2", weight: "400" },
    { path: "../fonts/Switzer-500.woff2", weight: "500" },
    { path: "../fonts/Switzer-600.woff2", weight: "600" },
  ],
  variable: "--font-switzer",
  display: "swap",
});

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Upfront — know which clients to bill upfront",
  description:
    "Before you invoice a company on credit, Upfront buys the public records that matter, applies your credit policy and gives you the payment terms, every reason backed by a receipt.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = { themeColor: "#0b0b0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${switzer.variable} ${geistMono.variable}`}>
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
