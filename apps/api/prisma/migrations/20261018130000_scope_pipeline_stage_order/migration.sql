DROP INDEX IF EXISTS "PipelineStage_order_key";

CREATE UNIQUE INDEX "PipelineStage_pipelineId_order_key"
ON "PipelineStage"("pipelineId", "order");
