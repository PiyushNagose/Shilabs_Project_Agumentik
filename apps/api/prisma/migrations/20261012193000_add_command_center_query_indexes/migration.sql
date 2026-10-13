CREATE INDEX "Lead_workspaceId_status_score_idx"
ON "Lead"("workspaceId", "status", "score");

CREATE INDEX "Deal_workspaceId_status_currency_idx"
ON "Deal"("workspaceId", "status", "currency");

CREATE INDEX "Activity_workspaceId_visibility_type_actorType_idx"
ON "Activity"("workspaceId", "visibility", "type", "actorType");

CREATE INDEX "FollowUpAttempt_leadId_status_sentAt_kind_idx"
ON "FollowUpAttempt"("leadId", "status", "sentAt", "kind");

CREATE INDEX "Message_conversationId_createdAt_direction_senderType_idx"
ON "Message"("conversationId", "createdAt", "direction", "senderType");
