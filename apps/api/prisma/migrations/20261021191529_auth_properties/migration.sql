-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "StartMethod" AS ENUM ('IMPORT', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "termsVersion" TEXT NOT NULL DEFAULT '2026-10-21-local',
    "acceptedTermsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "responsible" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(30),
    "startMethod" "StartMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "userId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("userId","propertyId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "activePropertyId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionToken" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_propertyId_idx" ON "Membership"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionToken_tokenHash_key" ON "ActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ActionToken_userId_kind_idx" ON "ActionToken"("userId", "kind");

-- CreateIndex
CREATE INDEX "ActionToken_expiresAt_idx" ON "ActionToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activePropertyId_fkey" FOREIGN KEY ("activePropertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
