ALTER TABLE "sheets" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheets_team_idx" ON "sheets" USING btree ("team_id");--> statement-breakpoint
UPDATE sheets s SET team_id = u.team_id FROM users u WHERE u.id = s.employee_id AND s.team_id IS NULL;
