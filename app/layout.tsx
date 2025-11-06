import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnapShrink | Image Compressor",
  description:
    "Compress images in your browser with adjustable quality, dimensions, and batch download support."
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
