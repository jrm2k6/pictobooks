import React from "react";
import { useClerk, useUser } from "@clerk/react";
import { Link, useLocation } from "@tanstack/react-router";
import styles from "./app-shell.module.css";

function UserMenu() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);

  const initials = user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "?";
  const displayName = user?.firstName ? `${user.firstName}'s books` : "My books";

  return (
    <div className={styles.userMenuWrap}>
      <button className={styles.userMenuBtn} onClick={() => setOpen((v) => !v)}>
        <span className={styles.userAvatar}>{initials}</span>
        {displayName}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.userMenuOverlay} onClick={() => setOpen(false)} />
          <div className={styles.userMenuDropdown}>
            <button
              className={styles.userMenuAction}
              onClick={() => { setOpen(false); signOut({ redirectUrl: "/sign-in" }); }}
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

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <a href="/" className={styles.brand}>
            <img src="/images/pictobook-logo.webp" alt="" height="28" />
            pictobook
          </a>
          <nav className={styles.nav}>
            <Link to="/books" className={styles.navLink} data-active={pathname === "/books" || undefined}>
              My books
            </Link>
          </nav>
        </div>
        <UserMenu />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
