import type { Metadata } from "next";
import { HomePage } from "@/app/home/components/HomePage";
import { OG_IMAGE_ALT, OG_IMAGE_PATH, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, softwareApplicationJsonLd, toJsonLdString } from "@/config/site";

// The front page is the one public, indexable page: it carries its own title, description and structured data.
// Next replaces the layout's openGraph and twitter objects as a whole (it does not merge their fields), so the type,
// the site name and the image are repeated here
export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt: OG_IMAGE_ALT }],
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE_PATH] },
};

export default function Home() {
  return (
    <>
      {/* A data block, not executed: the script-src hashes do not apply to it */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLdString(softwareApplicationJsonLd()) }} />
      <HomePage />
    </>
  );
}
