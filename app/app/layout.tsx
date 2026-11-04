import type { Metadata } from "next";

// The studio is a tool, not a landing page: keep it out of search results.
export const metadata: Metadata = {
  title: "Make an explainer",
  robots: { index: false, follow: true },
};

export default function StudioLayout({ children }: LayoutProps<"/app">) {
  return children;
}
