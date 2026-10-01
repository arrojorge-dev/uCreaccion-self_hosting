-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "outboxMessageId" TEXT;

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN     "outboxMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_outboxMessageId_key" ON "Notification"("outboxMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_outboxMessageId_key" ON "WebhookDelivery"("webhookId", "outboxMessageId");
