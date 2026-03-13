import { useEffect } from "react";

const DEFAULT_SITE_NAME = "Pictobook";
const DEFAULT_SITE_URL = "https://pictobook.app";
const DEFAULT_OG_IMAGE = "/images/hero_main.png";

type SeoProps = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  robots?: string;
  type?: "website" | "article";
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function getSiteUrl() {
  const envSiteUrl = import.meta.env.VITE_SITE_URL?.trim();
  if (envSiteUrl) {
    return envSiteUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }

  return DEFAULT_SITE_URL;
}

function toAbsoluteUrl(siteUrl: string, value: string) {
  if (/^https?:\/\//.test(value)) return value;
  return new URL(value.startsWith("/") ? value : `/${value}`, siteUrl).toString();
}

function upsertMeta(attribute: "name" | "property", key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`
  );
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
}

export default function Seo({
  title,
  description,
  path = "/",
  image = DEFAULT_OG_IMAGE,
  robots = "index,follow",
  type = "website",
  jsonLd,
}: SeoProps) {
  useEffect(() => {
    const siteUrl = getSiteUrl();
    const canonicalUrl = toAbsoluteUrl(siteUrl, path);
    const imageUrl = toAbsoluteUrl(siteUrl, image);
    const fullTitle = title.includes(DEFAULT_SITE_NAME)
      ? title
      : `${title} | ${DEFAULT_SITE_NAME}`;

    document.title = fullTitle;

    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", robots);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:site_name", DEFAULT_SITE_NAME);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:image", imageUrl);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", imageUrl);
    upsertLink("canonical", canonicalUrl);

    const existingJsonLd = document.head.querySelector(
      'script[data-seo-json-ld="true"]'
    );
    if (existingJsonLd) {
      existingJsonLd.remove();
    }

    if (jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seoJsonLd = "true";
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }, [description, image, jsonLd, path, robots, title, type]);

  return null;
}
