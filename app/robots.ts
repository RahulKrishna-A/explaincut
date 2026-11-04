import type { MetadataRoute } from "next";
import { SITE } from "@/lib/brand/site";

// /app is kept out of search with a noindex meta tag (see app/app/layout.tsx);
// it is not disallowed here, or crawlers could never read that tag.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
