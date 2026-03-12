/*
 * Pictobook Landing Page — Home
 * Design: Playful Craft Studio
 * Palette: Coral (#FF6B47) + Navy (#1A2332) + Gold (#FFD166) + Off-white (#FAFAF8)
 * Typography: Fraunces (display) + Plus Jakarta Sans (body)
 * Layout: Asymmetric, grid-breaking, oversized type, organic blob shapes
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  WAITLIST_ENDPOINT,
  type WaitlistSignupRequest,
  type WaitlistSignupResponse,
} from "@shared/waitlist";

const HERO_IMAGE = "/images/hero_main.png";
const FEATURE_UPLOAD = "/images/feature_upload.png";
const FEATURE_BOOK = "/images/feature_book.png";
const FEATURE_AGES = "/images/feature_ages.png";
const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement | string,
    options: {
      sitekey: string;
      theme?: "light" | "dark";
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function ensureTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(
      TURNSTILE_SCRIPT_ID
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Turnstile script failed to load.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Turnstile script failed to load."));
    document.head.appendChild(script);
  });
}

// Sparkle SVG
function Sparkle({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={`sparkle ${className}`}
      style={style}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z" />
    </svg>
  );
}

// Scroll reveal hook
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

function RevealSection({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, visible } = useScrollReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// Waitlist form (reusable)
function WaitlistForm({
  dark = false,
  compact = false,
}: {
  dark?: boolean;
  compact?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  const waitlistApiUrl = import.meta.env.VITE_WAITLIST_API_URL;
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileContainerRef.current) return;

    let disposed = false;
    ensureTurnstileScript()
      .then(() => {
        if (disposed || !window.turnstile || !turnstileContainerRef.current)
          return;
        if (turnstileWidgetIdRef.current) {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        }

        turnstileWidgetIdRef.current = window.turnstile.render(
          turnstileContainerRef.current,
          {
            sitekey: turnstileSiteKey,
            theme: dark ? "dark" : "light",
            callback: token => setTurnstileToken(token),
            "expired-callback": () => setTurnstileToken(null),
            "error-callback": () => setTurnstileToken(null),
          }
        );
      })
      .catch(() => {
        toast.error("Could not load anti-bot verification. Please refresh.");
      });

    return () => {
      disposed = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = null;
    };
  }, [dark, turnstileSiteKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (!waitlistApiUrl) {
      toast.error("Waitlist service is not configured yet.");
      return;
    }
    if (!turnstileSiteKey) {
      toast.error("Anti-bot verification is not configured yet.");
      return;
    }
    if (!turnstileToken) {
      toast.error("Please complete the verification challenge.");
      return;
    }

    setLoading(true);
    try {
      const queryParams = new URLSearchParams(window.location.search);
      const payload: WaitlistSignupRequest = {
        email,
        turnstileToken,
        source: "landing",
        page: "home",
        campaign: queryParams.get("utm_campaign") || undefined,
      };

      const response = await fetch(
        `${waitlistApiUrl.replace(/\/$/, "")}${WAITLIST_ENDPOINT}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const data = (await response.json()) as WaitlistSignupResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Request failed." : data.message);
      }

      setSubmitted(true);
      toast.success("You're on the list! We'll be in touch soon.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not join waitlist. Please try again."
      );
    } finally {
      setLoading(false);
      setTurnstileToken(null);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    }
  };

  if (submitted) {
    return (
      <div
        className={`flex items-center gap-3 ${compact ? "text-sm" : "text-base"} font-semibold ${dark ? "text-white" : "text-[oklch(0.22_0.04_255)]"}`}
      >
        <span
          className={`inline-flex items-center rounded-md border-2 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] rotate-[-3deg] ${
            dark
              ? "border-[oklch(0.88_0.15_85)] text-[oklch(0.88_0.15_85)] bg-white/5"
              : "border-[oklch(0.65_0.18_30)] text-[oklch(0.65_0.18_30)] bg-white"
          }`}
          aria-label="On the list stamp"
        >
          On The List
        </span>
        <span>You're on the waitlist! We'll email you when we launch.</span>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-col ${compact ? "gap-2" : "gap-3"} w-full max-w-md`}
    >
      <div className={`grid ${compact ? "gap-2" : "gap-3"} sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start`}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Enter your email address"
          className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[oklch(0.65_0.18_30)] ${
            dark
              ? "bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white"
              : "bg-white border-[oklch(0.9_0.01_80)] text-[oklch(0.15_0.03_255)] placeholder:text-[oklch(0.6_0.01_80)] focus:border-[oklch(0.65_0.18_30)]"
          }`}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="btn-coral rounded-xl px-6 py-3 text-sm font-bold whitespace-nowrap disabled:opacity-60 sm:col-start-2"
        >
          {loading ? "Joining…" : "Join the Waitlist"}
        </button>
        <div className="sm:col-start-1">
          <div ref={turnstileContainerRef} className={`${dark ? "[&_iframe]:opacity-90" : ""}`} />
        </div>
      </div>
    </form>
  );
}

export default function Home() {
  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{ background: "oklch(0.99 0.005 80)" }}
    >
      {/* ── NAV ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b border-[oklch(0.9_0.01_80)/60]"
        style={{ background: "oklch(0.99 0.005 80 / 0.9)" }}
      >
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <img
              src="/images/pictobook-logo.png"
              alt="Pictobook logo"
              className="w-8 h-8"
            />
            <span
              className="font-bold text-lg tracking-tight"
              style={{
                fontFamily: "Fraunces, serif",
                color: "oklch(0.22 0.04 255)",
              }}
            >
              Pictobook
            </span>
          </div>
          <a
            href="#waitlist"
            className="btn-coral rounded-full px-5 py-2 text-sm font-bold"
            onClick={e => {
              e.preventDefault();
              document
                .getElementById("waitlist")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Join Waitlist
          </a>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-24 pb-0 overflow-hidden">
        {/* Background blob */}
        <div
          className="blob-morph absolute -top-32 -right-32 w-[600px] h-[600px] opacity-20 pointer-events-none"
          style={{ background: "oklch(0.65 0.18 30)", zIndex: 0 }}
        />
        <div
          className="blob-morph absolute -bottom-16 -left-16 w-[400px] h-[400px] opacity-15 pointer-events-none"
          style={{
            background: "oklch(0.88 0.15 85)",
            zIndex: 0,
            animationDelay: "-3s",
          }}
        />

        <div className="container relative z-10">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            {/* Left: Text */}
            <div className="pt-8 lg:pt-16 pb-8">
              {/* Badge */}
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest mb-6"
                style={{
                  background: "oklch(0.96 0.06 85)",
                  color: "oklch(0.22 0.04 255)",
                }}
              >
                <Sparkle
                  className="w-3 h-3"
                  style={{ color: "oklch(0.65 0.18 30)" }}
                />
                Coming Soon
              </div>

              <h1
                className="text-5xl sm:text-6xl lg:text-7xl font-black leading-[1.05] tracking-tight mb-6"
                style={{
                  fontFamily: "Fraunces, serif",
                  color: "oklch(0.22 0.04 255)",
                }}
              >
                Turn Your
                <span
                  className="block italic"
                  style={{ color: "oklch(0.65 0.18 30)" }}
                >
                  Family Photos
                </span>
                Into Coloring Books
              </h1>

              <p
                className="text-lg text-[oklch(0.45_0.02_255)] leading-relaxed mb-8 max-w-md"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                Upload photos of your pets, family, and adventures. We turn them
                into personalized coloring books made just for your child — with
                age-appropriate detail.
              </p>

              <WaitlistForm />

              <p
                className="mt-3 text-xs text-[oklch(0.6_0.01_80)]"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                No spam. Unsubscribe anytime. Early access + launch discount for
                waitlist members.
              </p>

              {/* Social proof numbers */}
              <div className="flex gap-8 mt-10 pt-8 border-t border-[oklch(0.9_0.01_80)]">
                <div>
                  <div
                    className="text-2xl font-black"
                    style={{
                      fontFamily: "Fraunces, serif",
                      color: "oklch(0.22 0.04 255)",
                    }}
                  >
                    3–12
                  </div>
                  <div className="text-xs text-[oklch(0.55_0.02_255)] font-medium mt-0.5">
                    Age range supported
                  </div>
                </div>
                <div>
                  <div
                    className="text-2xl font-black"
                    style={{
                      fontFamily: "Fraunces, serif",
                      color: "oklch(0.22 0.04 255)",
                    }}
                  >
                    5–10
                  </div>
                  <div className="text-xs text-[oklch(0.55_0.02_255)] font-medium mt-0.5">
                    Photos per book
                  </div>
                </div>
                <div>
                  <div
                    className="text-2xl font-black"
                    style={{
                      fontFamily: "Fraunces, serif",
                      color: "oklch(0.22 0.04 255)",
                    }}
                  >
                    PDF
                  </div>
                  <div className="text-xs text-[oklch(0.55_0.02_255)] font-medium mt-0.5">
                    Instant download
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Hero image */}
            <div className="relative flex justify-center lg:justify-end pb-0">
              {/* Decorative blob behind image */}
              <div
                className="absolute inset-0 -m-8 rounded-[40%_60%_55%_45%/45%_55%_60%_40%] opacity-30"
                style={{ background: "oklch(0.96 0.06 85)" }}
              />
              <div className="relative float-anim">
                <img
                  src={HERO_IMAGE}
                  alt="Photo transformed into a coloring page"
                  className="w-full max-w-[600px] rounded-2xl shadow-2xl"
                  style={{
                    boxShadow: "0 32px 80px oklch(0.22 0.04 255 / 0.2)",
                  }}
                />
                {/* Floating badge */}
                <div
                  className="absolute -bottom-4 -left-4 rounded-2xl px-4 py-3 shadow-xl"
                  style={{ background: "oklch(0.22 0.04 255)", color: "white" }}
                >
                  <div className="text-xs font-semibold opacity-70 mb-0.5">
                    Powered by AI
                  </div>
                  <div className="text-sm font-bold">Photo → Coloring Page</div>
                </div>
                <div
                  className="absolute -top-4 -right-4 rounded-2xl px-4 py-3 shadow-xl"
                  style={{
                    background: "oklch(0.88 0.15 85)",
                    color: "oklch(0.22 0.04 255)",
                  }}
                >
                  <div className="text-xs font-semibold opacity-70 mb-0.5">
                    Ages 3–12
                  </div>
                  <div className="text-sm font-bold">Difficulty Scaling</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Wave divider */}
        <div className="relative mt-16" style={{ height: "80px" }}>
          <svg
            viewBox="0 0 1440 80"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{ fill: "oklch(0.22 0.04 255)" }}
          >
            <path d="M0,40 C360,80 1080,0 1440,40 L1440,80 L0,80 Z" />
          </svg>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-20" style={{ background: "oklch(0.22 0.04 255)" }}>
        <div className="container">
          <RevealSection>
            <div className="text-center mb-16">
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest mb-4"
                style={{ background: "oklch(0.65 0.18 30)", color: "white" }}
              >
                <Sparkle className="w-3 h-3" />
                How It Works
              </div>
              <h2
                className="text-4xl sm:text-5xl font-black text-white leading-tight"
                style={{ fontFamily: "Fraunces, serif" }}
              >
                As easy as 1, 2, 3
              </h2>
              <p
                className="mt-4 text-[oklch(0.75_0.02_255)] max-w-lg mx-auto text-base"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                From photo to personalized coloring book in minutes — no design
                skills needed.
              </p>
            </div>
          </RevealSection>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {[
              {
                num: "01",
                title: "Upload Your Photos",
                desc: "Share photos of your family, pets, home, or favorite places — anything that matters to your child.",
                image: FEATURE_UPLOAD,
                delay: 0,
              },
              {
                num: "02",
                title: "Choose Their Age",
                desc: "We adjust the detail level to match your child's age: simple bold shapes for toddlers, richer detail for older kids.",
                image: FEATURE_AGES,
                delay: 100,
              },
              {
                num: "03",
                title: "Download & Print",
                desc: "Get a beautifully compiled PDF coloring book, ready to print at home or order as a real printed book.",
                image: FEATURE_BOOK,
                delay: 200,
              },
            ].map(step => (
              <RevealSection key={step.num} delay={step.delay}>
                <div
                  className="rounded-2xl overflow-hidden group hover:scale-[1.02] transition-transform duration-300"
                  style={{ background: "oklch(0.28 0.04 255)" }}
                >
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={step.image}
                      alt={step.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-6">
                    <div className="step-number text-5xl mb-3">{step.num}</div>
                    <h3
                      className="text-xl font-bold text-white mb-2"
                      style={{ fontFamily: "Fraunces, serif" }}
                    >
                      {step.title}
                    </h3>
                    <p
                      className="text-[oklch(0.7_0.02_255)] text-sm leading-relaxed"
                      style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                    >
                      {step.desc}
                    </p>
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>

        {/* Wave divider bottom */}
        <div className="relative mt-20" style={{ height: "80px" }}>
          <svg
            viewBox="0 0 1440 80"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{ fill: "oklch(0.99 0.005 80)" }}
          >
            <path d="M0,40 C360,0 1080,80 1440,40 L1440,80 L0,80 Z" />
          </svg>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-20" style={{ background: "oklch(0.99 0.005 80)" }}>
        <div className="container">
          <RevealSection>
            <div className="text-center mb-16">
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest mb-4"
                style={{
                  background: "oklch(0.96 0.06 85)",
                  color: "oklch(0.22 0.04 255)",
                }}
              >
                <Sparkle
                  className="w-3 h-3"
                  style={{ color: "oklch(0.65 0.18 30)" }}
                />
                Features
              </div>
              <h2
                className="text-4xl sm:text-5xl font-black leading-tight"
                style={{
                  fontFamily: "Fraunces, serif",
                  color: "oklch(0.22 0.04 255)",
                }}
              >
                A coloring book as unique
                <span
                  className="block italic"
                  style={{ color: "oklch(0.65 0.18 30)" }}
                >
                  as your child
                </span>
              </h2>
            </div>
          </RevealSection>

          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: "📸",
                title: "Personalized to Your Life",
                desc: "Every page features something your child already loves: your dog, your house, your family, your vacations. Generic coloring books can't compete with that.",
                bg: "oklch(0.95 0.04 35)",
                delay: 0,
              },
              {
                icon: "🎯",
                title: "Age-Appropriate Detail",
                desc: "Thick outlines and large shapes for ages 3–5, moderate detail for 6–8, and rich line art for 9–12. The same photo produces a different book for each age group.",
                bg: "oklch(0.96 0.06 85)",
                delay: 100,
              },
              {
                icon: "📄",
                title: "Print-Ready PDF",
                desc: "Download a high-resolution 8.5×11 inch PDF instantly. Print at home, at a local print shop, or order a professionally printed softcover book.",
                bg: "oklch(0.96 0.06 85)",
                delay: 200,
              },
              {
                icon: "✨",
                title: "Powered by AI",
                desc: "Our AI pipeline converts your photos into clean, beautiful coloring page line art automatically — no manual tracing, no design skills needed.",
                bg: "oklch(0.95 0.04 35)",
                delay: 300,
              },
            ].map(feature => (
              <RevealSection key={feature.title} delay={feature.delay}>
                <div
                  className="rounded-2xl p-8 h-full hover:shadow-lg transition-shadow duration-300"
                  style={{ background: feature.bg }}
                >
                  <div className="text-4xl mb-4">{feature.icon}</div>
                  <h3
                    className="text-xl font-bold mb-3"
                    style={{
                      fontFamily: "Fraunces, serif",
                      color: "oklch(0.22 0.04 255)",
                    }}
                  >
                    {feature.title}
                  </h3>
                  <p
                    className="text-[oklch(0.4_0.02_255)] leading-relaxed"
                    style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                  >
                    {feature.desc}
                  </p>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGE COMPARISON ── */}
      <section
        className="py-20 relative overflow-hidden"
        style={{ background: "oklch(0.96 0.06 85)" }}
      >
        <Sparkle className="absolute top-8 right-12 w-6 h-6 text-[oklch(0.65_0.18_30)] opacity-60" />
        <Sparkle className="absolute bottom-12 left-8 w-4 h-4 text-[oklch(0.65_0.18_30)] opacity-40" />

        <div className="container">
          <RevealSection>
            <div className="max-w-2xl mx-auto text-center mb-12">
              <h2
                className="text-4xl sm:text-5xl font-black leading-tight mb-4"
                style={{
                  fontFamily: "Fraunces, serif",
                  color: "oklch(0.22 0.04 255)",
                }}
              >
                One photo. Three age levels.
              </h2>
              <p
                className="text-[oklch(0.4_0.02_255)] text-base"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                The same photo produces a completely different coloring page
                depending on your child's age — automatically.
              </p>
            </div>
          </RevealSection>

          <RevealSection delay={150}>
            <div className="overflow-x-auto">
              <table
                className="w-full max-w-2xl mx-auto rounded-2xl overflow-hidden shadow-lg"
                style={{ background: "white" }}
              >
                <thead>
                  <tr style={{ background: "oklch(0.22 0.04 255)" }}>
                    <th
                      className="px-6 py-4 text-left text-white text-sm font-bold"
                      style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                    >
                      Age Group
                    </th>
                    <th
                      className="px-6 py-4 text-left text-white text-sm font-bold"
                      style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                    >
                      Output Style
                    </th>
                    <th
                      className="px-6 py-4 text-left text-white text-sm font-bold"
                      style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                    >
                      Best For
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      age: "Ages 3–5",
                      style: "Very simple shapes, thick bold outlines",
                      best: "Toddlers & preschoolers",
                      color: "oklch(0.95 0.04 35)",
                    },
                    {
                      age: "Ages 6–8",
                      style: "Moderate detail, clear regions",
                      best: "Early elementary",
                      color: "white",
                    },
                    {
                      age: "Ages 9–12",
                      style: "Detailed line art, fine strokes",
                      best: "Older children",
                      color: "oklch(0.95 0.04 35)",
                    },
                  ].map(row => (
                    <tr key={row.age} style={{ background: row.color }}>
                      <td
                        className="px-6 py-4 font-bold text-sm"
                        style={{
                          fontFamily: "Fraunces, serif",
                          color: "oklch(0.22 0.04 255)",
                        }}
                      >
                        {row.age}
                      </td>
                      <td
                        className="px-6 py-4 text-sm text-[oklch(0.4_0.02_255)]"
                        style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                      >
                        {row.style}
                      </td>
                      <td
                        className="px-6 py-4 text-sm text-[oklch(0.4_0.02_255)]"
                        style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                      >
                        {row.best}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── WAITLIST CTA ── */}
      <section
        id="waitlist"
        className="py-24 relative overflow-hidden"
        style={{ background: "oklch(0.22 0.04 255)" }}
      >
        {/* Background decorations */}
        <div
          className="blob-morph absolute -top-24 -left-24 w-[500px] h-[500px] opacity-10 pointer-events-none"
          style={{ background: "oklch(0.65 0.18 30)" }}
        />
        <div
          className="blob-morph absolute -bottom-24 -right-24 w-[400px] h-[400px] opacity-10 pointer-events-none"
          style={{ background: "oklch(0.88 0.15 85)", animationDelay: "-4s" }}
        />
        <Sparkle className="absolute top-12 right-24 w-8 h-8 text-[oklch(0.88_0.15_85)] opacity-50" />
        <Sparkle className="absolute bottom-16 left-20 w-5 h-5 text-[oklch(0.65_0.18_30)] opacity-40" />

        <div className="container relative z-10">
          <div className="max-w-2xl mx-auto text-center">
            <RevealSection>
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest mb-6"
                style={{ background: "oklch(0.65 0.18 30)", color: "white" }}
              >
                <Sparkle className="w-3 h-3" />
                Early Access
              </div>
              <h2
                className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight mb-6"
                style={{ fontFamily: "Fraunces, serif" }}
              >
                Be the First
                <span
                  className="block italic"
                  style={{ color: "oklch(0.88 0.15 85)" }}
                >
                  to Create Yours
                </span>
              </h2>
              <p
                className="text-[oklch(0.75_0.02_255)] text-lg mb-10 leading-relaxed"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                We're putting the finishing touches on Pictobook. Join the
                waitlist to get early access and a special launch discount.
              </p>

              <div className="flex justify-center">
                <WaitlistForm dark />
              </div>
              <p
                className="mt-4 text-xs text-[oklch(0.55_0.02_255)]"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                No spam. Unsubscribe anytime.
              </p>
            </RevealSection>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        className="py-10 border-t border-[oklch(0.9_0.01_80)]"
        style={{ background: "oklch(0.99 0.005 80)" }}
      >
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <img
              src="/images/pictobook-logo.png"
              alt="Pictobook logo"
              className="w-7 h-7"
            />
            <span
              className="font-bold text-base"
              style={{
                fontFamily: "Fraunces, serif",
                color: "oklch(0.22 0.04 255)",
              }}
            >
              Pictobook
            </span>
          </div>
          <p
            className="text-xs text-[oklch(0.6_0.01_80)] shrink-0"
            style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
          >
            © 2026 Pictobook. All rights reserved.
          </p>
          <div
            className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-[oklch(0.6_0.01_80)]"
            style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
          >
            <Link
              href="/legal/privacy-policy"
              className="hover:text-[oklch(0.65_0.18_30)] transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/legal/terms-of-service"
              className="hover:text-[oklch(0.65_0.18_30)] transition-colors"
            >
              Terms of Service
            </Link>
            <Link
              href="/legal/cookies"
              className="hover:text-[oklch(0.65_0.18_30)] transition-colors"
            >
              Cookie Policy
            </Link>
            <Link
              href="/legal/refunds"
              className="hover:text-[oklch(0.65_0.18_30)] transition-colors"
            >
              Refunds
            </Link>
            <Link
              href="/legal/dmca"
              className="hover:text-[oklch(0.65_0.18_30)] transition-colors"
            >
              DMCA
            </Link>
            <Link
              href="/legal/acceptable-use"
              className="hover:text-[oklch(0.65_0.18_30)] transition-colors"
            >
              Acceptable Use
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
