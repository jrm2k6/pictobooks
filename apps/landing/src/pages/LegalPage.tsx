import ReactMarkdown from "react-markdown";
import { Link } from "wouter";
import Seo from "@/components/Seo";

interface LegalPageProps {
  content: string;
  title: string;
  description: string;
  path: string;
}

export default function LegalPage({
  content,
  title,
  description,
  path,
}: LegalPageProps) {
  const logoImage = "/images/pictobook-logo.optimized.webp";
  return (
    <div className="min-h-screen" style={{ background: "oklch(0.99 0.005 80)" }}>
      <Seo title={title} description={description} path={path} />
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b border-[oklch(0.9_0.01_80)/60]" style={{ background: "oklch(0.99 0.005 80 / 0.9)" }}>
        <div className="container flex items-center h-16">
          <Link href="/" className="flex items-center gap-2">
            <img
              src={logoImage}
              alt="Pictobook logo"
              className="w-8 h-8"
              width={128}
              height={128}
              loading="eager"
              decoding="async"
            />
            <span className="font-bold text-lg tracking-tight" style={{ fontFamily: "Fraunces, serif", color: "oklch(0.22 0.04 255)" }}>
              Pictobook
            </span>
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="container pt-28 pb-20 max-w-3xl">
        <ReactMarkdown
          components={{
            h1: ({ children }) => (
              <h1 className="text-4xl font-black mb-2 tracking-tight" style={{ fontFamily: "Fraunces, serif", color: "oklch(0.22 0.04 255)" }}>
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-xl font-bold mt-10 mb-3" style={{ fontFamily: "Fraunces, serif", color: "oklch(0.22 0.04 255)" }}>
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-base font-bold mt-6 mb-2" style={{ fontFamily: "Plus Jakarta Sans, sans-serif", color: "oklch(0.22 0.04 255)" }}>
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p className="text-sm leading-relaxed mb-4" style={{ fontFamily: "Plus Jakarta Sans, sans-serif", color: "oklch(0.35 0.03 255)" }}>
                {children}
              </p>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold" style={{ color: "oklch(0.25 0.04 255)" }}>{children}</strong>
            ),
            ul: ({ children }) => (
              <ul className="list-disc list-inside mb-4 space-y-1 text-sm" style={{ fontFamily: "Plus Jakarta Sans, sans-serif", color: "oklch(0.35 0.03 255)" }}>
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-inside mb-4 space-y-1 text-sm" style={{ fontFamily: "Plus Jakarta Sans, sans-serif", color: "oklch(0.35 0.03 255)" }}>
                {children}
              </ol>
            ),
            a: ({ href, children }) => (
              <a href={href} className="underline hover:text-[oklch(0.65_0.18_30)] transition-colors" style={{ color: "oklch(0.22 0.04 255)" }}>
                {children}
              </a>
            ),
            hr: () => <hr className="my-8 border-[oklch(0.9_0.01_80)]" />,
          }}
        >
          {content}
        </ReactMarkdown>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-[oklch(0.9_0.01_80)]" style={{ background: "oklch(0.99 0.005 80)" }}>
        <div className="container flex justify-center">
          <p className="text-xs text-[oklch(0.6_0.01_80)]" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
            © 2026 Pictobook. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
