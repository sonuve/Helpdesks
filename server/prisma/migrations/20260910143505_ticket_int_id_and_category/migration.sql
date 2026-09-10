/*
  Warnings:

  - The primary key for the `ticket` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `ticket` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL_QUESTION', 'TECHNICAL_QUESTION', 'REFUND_REQUEST');

-- AlterTable
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_pkey",
ADD COLUMN     "category" "TicketCategory",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "ticket_pkey" PRIMARY KEY ("id");
