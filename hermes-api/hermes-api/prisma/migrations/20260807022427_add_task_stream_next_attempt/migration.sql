-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "stream" BOOLEAN NOT NULL DEFAULT false;
