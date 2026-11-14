/**
 * Business presentation components (grid cells, badges, provenance, detail sheet).
 *
 *   import { BusinessSheet, WebsiteStatusBadge, renderBusinessCell } from "@/components/business";
 */
export { BusinessSheet, type BusinessSheetProps } from "./business-sheet";
export {
  EmailStatusBadge,
  LeadStatusBadge,
  LiveIndicator,
  PhoneStatusBadge,
  ProvenanceTag,
  QualityBadge,
  RestrictedValue,
  SourceBadge,
  VerificationBadge,
  WebsiteStatusBadge,
  type ProvenanceOrigin,
} from "./badges";
export { COLUMN_WIDTHS, NUMERIC_COLUMNS, NameCell, renderBusinessCell, type CellRenderContext } from "./cells";
export { CopyButton } from "./copy-button";
export { SocialLinks } from "./socials";
export * from "./labels";
export * from "./row-utils";
