CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "search_jobs_status_updated_idx" ON "search_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "search_jobs_results_expiry_idx" ON "search_jobs" USING btree ("results_expire_at") WHERE "search_jobs"."results_purged_at" is null;