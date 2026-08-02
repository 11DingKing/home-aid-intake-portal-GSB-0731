import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home Aid Intake Portal",
  description: "Accessible legal-aid pre-application and staff continuation portal.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className="site-header">
          <div className="container">
            <span className="brand">Home Aid Intake Portal</span>
            <nav aria-label="Primary">
              <a href="/">Applicant</a>
              <a href="/staff">Staff</a>
            </nav>
          </div>
        </header>
        <main id="main" className="container" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
