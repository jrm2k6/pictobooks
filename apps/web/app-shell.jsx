import React from "react";
import { useClerk, useUser } from "@clerk/react";
import { Link, useLocation } from "@tanstack/react-router";

function UserMenu() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);

  const initials = user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "?";
  const displayName = user?.firstName
    ? `${user.firstName}'s books`
    : "My books";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "none",
          border: "1px solid #e8eceb",
          borderRadius: "24px",
          padding: "6px 12px 6px 6px",
          cursor: "pointer",
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontSize: "14px",
          fontWeight: 500,
          color: "#203649",
        }}
      >
        <span style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          background: "oklch(0.65 0.18 30)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "12px",
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {initials}
        </span>
        {displayName}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="#73818b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
          <div style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            background: "#fff",
            border: "1px solid #e8eceb",
            borderRadius: "12px",
            boxShadow: "0 4px 24px rgba(32,54,73,0.10)",
            minWidth: "160px",
            zIndex: 20,
            overflow: "hidden",
          }}>
            <button
              onClick={() => { setOpen(false); signOut({ redirectUrl: "/sign-in" }); }}
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "none",
                border: "none",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: '"Plus Jakarta Sans", sans-serif',
                fontSize: "14px",
                color: "#203649",
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }) {
  const { pathname } = useLocation();

  const navLinkStyle = (path) => ({
    textDecoration: "none",
    fontSize: "14px",
    fontWeight: 500,
    color: pathname === path ? "#203649" : "#73818b",
    paddingBottom: "2px",
    borderBottom: pathname === path ? "2px solid oklch(0.65 0.18 30)" : "2px solid transparent",
    fontFamily: '"Plus Jakarta Sans", sans-serif',
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f9f7f4", display: "flex", flexDirection: "column" }}>
      <header style={{
        background: "#fff",
        borderBottom: "1px solid #e8eceb",
        padding: "0 24px",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
            <img src="/images/pictobook-logo.webp" alt="" height="28" />
            <span style={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontSize: "15px", fontWeight: 700, color: "#203649" }}>
              pictobook
            </span>
          </a>
          <nav style={{ display: "flex", gap: "24px" }}>
            <Link to="/books" style={navLinkStyle("/books")}>My books</Link>
            <Link to="/how-it-works" style={navLinkStyle("/how-it-works")}>How it works</Link>
          </nav>
        </div>
        <UserMenu />
      </header>
      <main style={{ flex: 1, padding: "40px 24px", maxWidth: "900px", width: "100%", margin: "0 auto" }}>
        {children}
      </main>
    </div>
  );
}
