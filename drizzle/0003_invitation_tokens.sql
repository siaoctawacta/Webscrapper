ALTER TABLE "invitations" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash");