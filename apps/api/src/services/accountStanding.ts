/**
 * Who is allowed to use the private parts of the community layer.
 *
 * Private one-to-one messaging is the only place on AnimBook where an adult
 * stranger can reach one specific reader out of sight of everyone else, so the
 * rule is absolute and it is enforced here, once, on the server: a protected
 * account neither sends nor receives a message, and no setting, invite or
 * older thread overrides that.
 *
 * An account is protected when any of these is true:
 *   - accountKind is SCHOOL (a teacher has put them in a classroom)
 *   - accountKind is MINOR (declared under 18)
 *   - communityDisabled is set (switched off by hand, or by the school flow)
 *   - they hold a STUDENT place in any classroom
 *
 * The classroom check is deliberately belt-and-braces: accountKind is set when
 * a student is added to a classroom, but if that write is ever missed, the
 * membership row still closes the door.
 */
import { prisma } from "../db.js";

export type Standing = {
  userId: string;
  protected: boolean;
  /** Why, for logs and tests. Never shown to the other party. */
  reason?: "school" | "minor" | "disabled" | "classroom";
};

export interface StandingFacts {
  accountKind: string;
  communityDisabled: boolean;
  classroomMemberships: number;
}

/**
 * The decision itself, with no database in the way, so it can be tested
 * directly. Unknown or missing facts are treated as protected: the failure
 * mode of this function has to be "no messaging", never "messaging".
 */
export function verdictFor(facts: StandingFacts | null | undefined): Omit<Standing, "userId"> {
  if (!facts) return { protected: true, reason: "disabled" };
  if (facts.accountKind === "SCHOOL") return { protected: true, reason: "school" };
  if (facts.accountKind === "MINOR") return { protected: true, reason: "minor" };
  if (facts.communityDisabled) return { protected: true, reason: "disabled" };
  if (facts.classroomMemberships > 0) return { protected: true, reason: "classroom" };
  if (facts.accountKind !== "ADULT") return { protected: true, reason: "disabled" };
  return { protected: false };
}

export async function standingFor(userId: string): Promise<Standing> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountKind: true,
      communityDisabled: true,
      _count: { select: { classroomMemberships: true } }
    }
  });
  return {
    userId,
    ...verdictFor(
      user
        ? {
            accountKind: user.accountKind,
            communityDisabled: user.communityDisabled,
            classroomMemberships: user._count.classroomMemberships
          }
        : null
    )
  };
}

/** Both parties at once, in one round trip each. */
export async function bothStandings(a: string, b: string): Promise<[Standing, Standing]> {
  return Promise.all([standingFor(a), standingFor(b)]) as Promise<[Standing, Standing]>;
}

/**
 * Mark an account as belonging to a school student and shut the private
 * surfaces. Called when a teacher adds a student to a classroom. It only ever
 * tightens: an account is never moved back to ADULT by this path.
 */
export async function markAsSchoolAccount(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { accountKind: "SCHOOL", communityDisabled: true, messagesOpen: false }
  });
}

/** Has this pair blocked each other, in either direction? */
export async function isBlockedPair(a: string, b: string): Promise<boolean> {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a }
      ]
    },
    select: { id: true }
  });
  return Boolean(block);
}
