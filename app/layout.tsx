import type { Metadata } from "next";
import { EB_Garamond } from "next/font/google";
import "./globals.css";
import "./animations.css"

export const metadata: Metadata = {
  title: "almost sent",
  description: "a tiny interactive experience about writing letters and letting go",
};

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-eb-garamond",
  weight: ["400", "500", "600", "700"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ebGaramond.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
