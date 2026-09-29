import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/lib/auth-context';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FormPilot — Universal AI Form Assistant",
  description: "Fill your profile once. FormPilot understands web forms, suggests grounded answers, and fills them only after you review. Verified on Google Forms and standard HTML, ARIA, dynamic and multi-step forms.",
  icons: {
    icon: [
      { url: "/logo-icon.png" },
      { url: "/favicon.ico" }
    ],
    shortcut: "/logo-icon.png",
    apple: "/logo-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-white selection:bg-indigo-500/30">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
