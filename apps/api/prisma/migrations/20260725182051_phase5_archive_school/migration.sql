-- CreateTable
CREATE TABLE "archive_projects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "steward" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "community_context" TEXT,
    "sensitivity_tier" TEXT NOT NULL DEFAULT 'MEDIUM',
    "book_id" TEXT,
    "partner_org" TEXT,
    "partner_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_consents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "subject_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consent_media_url" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT 'PUBLICATION',

    CONSTRAINT "archive_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_cultural_notes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "iconographic_concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voice_guidance" TEXT,
    "reviewer_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_cultural_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "school_name" TEXT,
    "grade_band" TEXT,
    "library_book_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_memberships" (
    "id" TEXT NOT NULL,
    "classroom_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_assignments" (
    "id" TEXT NOT NULL,
    "classroom_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "rubric" JSONB,
    "due_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_submissions" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "studio_project_id" TEXT,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "feedback_score" DOUBLE PRECISION,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "archive_projects_slug_key" ON "archive_projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "archive_projects_book_id_key" ON "archive_projects"("book_id");

-- CreateIndex
CREATE INDEX "archive_projects_sensitivity_tier_status_idx" ON "archive_projects"("sensitivity_tier", "status");

-- CreateIndex
CREATE INDEX "archive_consents_project_id_granted_at_idx" ON "archive_consents"("project_id", "granted_at");

-- CreateIndex
CREATE INDEX "archive_cultural_notes_project_id_category_idx" ON "archive_cultural_notes"("project_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_slug_key" ON "classrooms"("slug");

-- CreateIndex
CREATE INDEX "classrooms_teacher_id_updated_at_idx" ON "classrooms"("teacher_id", "updated_at");

-- CreateIndex
CREATE INDEX "classroom_memberships_student_id_idx" ON "classroom_memberships"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_memberships_classroom_id_student_id_key" ON "classroom_memberships"("classroom_id", "student_id");

-- CreateIndex
CREATE INDEX "classroom_assignments_classroom_id_created_at_idx" ON "classroom_assignments"("classroom_id", "created_at");

-- CreateIndex
CREATE INDEX "classroom_submissions_assignment_id_submitted_at_idx" ON "classroom_submissions"("assignment_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "archive_projects" ADD CONSTRAINT "archive_projects_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_consents" ADD CONSTRAINT "archive_consents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "archive_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_cultural_notes" ADD CONSTRAINT "archive_cultural_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "archive_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_memberships" ADD CONSTRAINT "classroom_memberships_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_memberships" ADD CONSTRAINT "classroom_memberships_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_assignments" ADD CONSTRAINT "classroom_assignments_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_submissions" ADD CONSTRAINT "classroom_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "classroom_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
