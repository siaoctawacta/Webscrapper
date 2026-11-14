/**
 * Field registry — the single allowlist for columns, sorting, filtering and export.
 * Field keys are snake_case and are what the API accepts (e.g. `sort=business_name:asc`).
 * Isomorphic: imported by both the UI and the server.
 */

export type FieldOrigin =
  /** Comes from the data provider (Google Places, sample data). Subject to source policy. */
  | "provider"
  /** Produced by our own visit to the business website. App-owned. */
  | "enrichment"
  /** Computed by the app from other fields. */
  | "derived"
  /** Entered by the user (collections only). */
  | "user";

export type FieldKind = "text" | "phone" | "url" | "email" | "number" | "date" | "enum" | "tags" | "json";

export type FieldContext = "results" | "collection";

export interface FieldDef {
  key: FieldKey;
  label: string;
  origin: FieldOrigin;
  kind: FieldKind;
  sortable: boolean;
  /** Shown by default in the grid. */
  defaultVisible: boolean;
  /** Included in the default export layout. */
  defaultExport: boolean;
  contexts: readonly FieldContext[];
  /** Short explanation for tooltips (provenance / how the value was obtained). */
  help?: string;
}

export const FIELD_KEYS = [
  "business_name",
  "category",
  "phone",
  "website",
  "website_status",
  "email",
  "email_status",
  "address",
  "city",
  "region",
  "country",
  "postal_code",
  "rating",
  "review_count",
  "maps_url",
  "latitude",
  "longitude",
  "socials",
  "business_status",
  "quality_status",
  "phone_status",
  "source",
  "source_record_id",
  "retrieved_at",
  "last_verified",
  "lead_status",
  "tags",
  "notes",
  "last_contacted",
  "added_at",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

const both = ["results", "collection"] as const;
const collectionOnly = ["collection"] as const;

const f = (def: Omit<FieldDef, "contexts"> & { contexts?: readonly FieldContext[] }): FieldDef => ({
  contexts: both,
  ...def,
});

export const FIELDS: Record<FieldKey, FieldDef> = {
  business_name: f({ key: "business_name", label: "Business name", origin: "provider", kind: "text", sortable: true, defaultVisible: true, defaultExport: true }),
  category: f({ key: "category", label: "Category", origin: "provider", kind: "text", sortable: true, defaultVisible: true, defaultExport: true, help: "Category from the data provider." }),
  phone: f({ key: "phone", label: "Phone", origin: "provider", kind: "phone", sortable: true, defaultVisible: true, defaultExport: true, help: "As listed by the provider. Not verified." }),
  website: f({ key: "website", label: "Website", origin: "provider", kind: "url", sortable: true, defaultVisible: true, defaultExport: true }),
  website_status: f({ key: "website_status", label: "Website status", origin: "enrichment", kind: "enum", sortable: true, defaultVisible: false, defaultExport: true, help: "None = no website listed. Present/unreachable = result of our own visit." }),
  email: f({ key: "email", label: "Email", origin: "enrichment", kind: "email", sortable: true, defaultVisible: true, defaultExport: true, help: "Published on the business's own website (or supplied by the provider). Never guessed. Not verified." }),
  email_status: f({ key: "email_status", label: "Email status", origin: "enrichment", kind: "enum", sortable: true, defaultVisible: false, defaultExport: true }),
  address: f({ key: "address", label: "Address", origin: "provider", kind: "text", sortable: true, defaultVisible: true, defaultExport: true }),
  city: f({ key: "city", label: "City", origin: "provider", kind: "text", sortable: true, defaultVisible: false, defaultExport: true }),
  region: f({ key: "region", label: "Region", origin: "provider", kind: "text", sortable: true, defaultVisible: false, defaultExport: false }),
  country: f({ key: "country", label: "Country", origin: "provider", kind: "text", sortable: true, defaultVisible: false, defaultExport: true }),
  postal_code: f({ key: "postal_code", label: "Postal code", origin: "provider", kind: "text", sortable: true, defaultVisible: false, defaultExport: false }),
  rating: f({ key: "rating", label: "Rating", origin: "provider", kind: "number", sortable: true, defaultVisible: true, defaultExport: true, help: "Provider rating at retrieval time; changes over time." }),
  review_count: f({ key: "review_count", label: "Reviews", origin: "provider", kind: "number", sortable: true, defaultVisible: true, defaultExport: true }),
  maps_url: f({ key: "maps_url", label: "Maps link", origin: "provider", kind: "url", sortable: false, defaultVisible: false, defaultExport: true }),
  latitude: f({ key: "latitude", label: "Latitude", origin: "provider", kind: "number", sortable: true, defaultVisible: false, defaultExport: false }),
  longitude: f({ key: "longitude", label: "Longitude", origin: "provider", kind: "number", sortable: true, defaultVisible: false, defaultExport: false }),
  socials: f({ key: "socials", label: "Social links", origin: "enrichment", kind: "json", sortable: false, defaultVisible: false, defaultExport: true, help: "Linked from the business's own website." }),
  business_status: f({ key: "business_status", label: "Business status", origin: "provider", kind: "enum", sortable: true, defaultVisible: false, defaultExport: false }),
  quality_status: f({ key: "quality_status", label: "Data quality", origin: "derived", kind: "enum", sortable: true, defaultVisible: true, defaultExport: true }),
  phone_status: f({ key: "phone_status", label: "Phone status", origin: "derived", kind: "enum", sortable: true, defaultVisible: false, defaultExport: false }),
  source: f({ key: "source", label: "Data source", origin: "derived", kind: "enum", sortable: true, defaultVisible: false, defaultExport: true }),
  source_record_id: f({ key: "source_record_id", label: "Provider ID", origin: "provider", kind: "text", sortable: false, defaultVisible: false, defaultExport: false }),
  retrieved_at: f({ key: "retrieved_at", label: "Retrieved", origin: "derived", kind: "date", sortable: true, defaultVisible: false, defaultExport: true }),
  last_verified: f({ key: "last_verified", label: "Last verified", origin: "derived", kind: "date", sortable: true, defaultVisible: false, defaultExport: false, help: "Only set after a real verification process." }),
  lead_status: f({ key: "lead_status", label: "Lead status", origin: "user", kind: "enum", sortable: true, defaultVisible: true, defaultExport: true, contexts: collectionOnly }),
  tags: f({ key: "tags", label: "Tags", origin: "user", kind: "tags", sortable: false, defaultVisible: true, defaultExport: true, contexts: collectionOnly }),
  notes: f({ key: "notes", label: "Notes", origin: "user", kind: "text", sortable: false, defaultVisible: false, defaultExport: true, contexts: collectionOnly }),
  last_contacted: f({ key: "last_contacted", label: "Last contacted", origin: "user", kind: "date", sortable: true, defaultVisible: false, defaultExport: true, contexts: collectionOnly }),
  added_at: f({ key: "added_at", label: "Added", origin: "user", kind: "date", sortable: true, defaultVisible: false, defaultExport: false, contexts: collectionOnly }),
};

export const isFieldKey = (v: string): v is FieldKey => (FIELD_KEYS as readonly string[]).includes(v);

export const fieldsFor = (ctx: FieldContext) => FIELD_KEYS.filter((k) => FIELDS[k].contexts.includes(ctx));
export const sortableFieldsFor = (ctx: FieldContext) => fieldsFor(ctx).filter((k) => FIELDS[k].sortable);
export const defaultColumns = (ctx: FieldContext) => fieldsFor(ctx).filter((k) => FIELDS[k].defaultVisible);
export const defaultExportColumns = (ctx: FieldContext) => fieldsFor(ctx).filter((k) => FIELDS[k].defaultExport);
