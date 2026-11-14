ALTER TABLE "proposals" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "source_record_id" text;--> statement-breakpoint
CREATE INDEX "proposals_user_place_idx" ON "proposals" USING btree ("user_id","source","source_record_id");