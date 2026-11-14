import type { Metadata } from "next";

export const metadata: Metadata = { title: "LeadFinderBot", robots: { index: true, follow: false } };

/** Public page linked from the crawler's User-Agent so site owners know who visited and how to opt out. */
export default function BotPage() {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-6 py-16 text-[15px] leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">About LeadFinderBot</h1>
      <p>
        LeadFinderBot visits the public website of a business when a user of LeadFinder looks that business up. It reads the
        homepage and, at most, a couple of contact or “about” pages to find contact details the business publishes itself —
        an email address, social media links and phone links — plus simple facts such as whether the site uses HTTPS.
      </p>
      <ul className="grid list-disc gap-2 pl-5">
        <li>It identifies itself with the User-Agent <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">LeadFinderBot/1.0</code>.</li>
        <li>It follows <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">robots.txt</code>. To opt out, add:
          <pre className="mt-2 rounded-lg bg-muted p-3 text-[13px]">User-agent: LeadFinderBot{"\n"}Disallow: /</pre>
        </li>
        <li>It requests only a few pages per site, slowly, and never submits forms, logs in or downloads files.</li>
        <li>It does not guess email addresses and only keeps details your site publishes.</li>
      </ul>
    </main>
  );
}
