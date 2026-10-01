-- Rename the unique login column from email to nickname, preserving data.
ALTER TABLE "User" RENAME COLUMN "email" TO "nickname";
ALTER INDEX "User_email_key" RENAME TO "User_nickname_key";
