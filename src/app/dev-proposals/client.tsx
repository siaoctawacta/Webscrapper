"use client";
// TEMPORARY visual-check page for the proposals module — delete after the check.
import * as React from "react";
import type { BusinessRow } from "@/lib/api-types";
import { ProposalButton, ProposalDialog } from "@/components/proposals/proposal-dialog";

const base: BusinessRow = {
  id: "x", source: "sample", sourceRecordId: "s", name: "Maquis Chez Ama", category: "Restaurant", categories: [], phone: "+228 90 12 34 56",
  phoneE164: "+22890123456", phoneStatus: "source_provided", website: null, websiteHost: null, websiteStatus: "none", websiteCheck: null,
  email: null, emails: [], emailOrigin: null, emailStatus: "unknown", socials: {}, address: null, city: "Lomé", region: null, country: "Togo",
  postalCode: null, lat: null, lng: null, rating: 4.5, reviewCount: 42, mapsUrl: null, businessStatus: null, qualityStatus: "complete",
  qualityIssues: [], duplicateOfId: null, aiCategory: null, retrievedAt: new Date().toISOString(), enrichedAt: null, lastVerifiedAt: null,
  restrictedFields: [], liveFields: [],
};

export function DevProposals({ id, kind, variant }: { id: string; kind: "result" | "lead"; variant: string }) {
  const business: BusinessRow =
    variant === "site"
      ? { ...base, name: "Hôtel Le Bénin", category: "Hotel", websiteStatus: "present", website: "http://hotel-le-benin.example", websiteHost: "hotel-le-benin.example", email: "contact@hotel-le-benin.example" }
      : base;
  const [open, setOpen] = React.useState(true);
  return (
    <div className="p-6">
      <ProposalButton businessRef={{ kind, id }} business={business} />
      <ProposalDialog open={open} onOpenChange={setOpen} businessRef={{ kind, id }} business={business} onSent={() => console.log("sent")} />
    </div>
  );
}
