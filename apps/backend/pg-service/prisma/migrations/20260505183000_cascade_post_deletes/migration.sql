-- Adjust foreign keys so deleting a post also removes its comments and reactions.

ALTER TABLE "Comment" DROP CONSTRAINT "Comment_postId_fkey";
ALTER TABLE "Reaction" DROP CONSTRAINT "Reaction_postId_fkey";

ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_postId_fkey"
    FOREIGN KEY ("postId")
    REFERENCES "Post"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "Reaction"
    ADD CONSTRAINT "Reaction_postId_fkey"
    FOREIGN KEY ("postId")
    REFERENCES "Post"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
