import type { Metadata } from "next";
import "./globals.css";
import { sora } from "./fonts";
import { Ai } from "./Ai";

export const metadata: Metadata = {
  title: "Movies++",
  description: "Built with ❤️ by DataStax DevRel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Ai>
      <html lang="en">
        <body
          className={`${sora.className} bg-black flex items-center text-white`}
        >
          {children}
        </body>
      </html>
    </Ai>
  );
}
