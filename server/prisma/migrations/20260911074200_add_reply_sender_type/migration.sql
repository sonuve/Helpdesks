-- CreateEnum
CREATE TYPE "ReplySenderType" AS ENUM ('AGENT', 'CUSTOMER');

-- AlterTable
ALTER TABLE "ticket_reply" ADD COLUMN     "senderType" "ReplySenderType" NOT NULL DEFAULT 'AGENT';
