/**
 * What a user actually holds.
 *
 * A role is a permission TEMPLATE. Assigning one gives its permissions, and an
 * administrator can then add more or take some away for that person specifically.
 * The effective set is therefore:
 *
 *     (union of the user's roles)  ∪  extraPermissions  −  revokedPermissions
 *
 * Pure on purpose — no database, no framework, no catalog lookups. It takes the
 * permission strings and returns permission strings, so the rule that decides
 * someone's authority can be read and tested in one place.
 *
 * ── Why roles stay live references ──────────────────────────────────────────
 * The alternative was to copy a role's permissions onto the user at assignment and
 * treat the copy as the truth. That breaks two things worth keeping: editing a role
 * would stop propagating to its holders, and removing a permission from a role would
 * take it from nobody. So roles are resolved fresh on every request and the
 * per-user sets are the exceptions layered over them. docs/14 §14.9.
 */

/** Two disjoint sets of per-user exceptions, layered over the roles. */
export interface PermissionOverrides {
  /** Granted on top of the roles. */
  extra: readonly string[]
  /** Withheld despite a role granting it. */
  revoked: readonly string[]
}

/**
 * Fold roles and overrides into the set the request context carries.
 *
 * Order matters and is not arbitrary: revocation is applied last, so removing a
 * permission wins over a role granting it. Adding it back is expressed by dropping
 * the revocation, not by also listing it in `extra` — which is why the two sets are
 * kept disjoint.
 */
export function effectivePermissions(
  fromRoles: readonly string[],
  overrides: PermissionOverrides,
): Set<string> {
  const effective = new Set(fromRoles)

  for (const key of overrides.extra) effective.add(key)
  for (const key of overrides.revoked) effective.delete(key)

  return effective
}

/**
 * Apply a role change to the user's revocations.
 *
 * A removal means "not this permission, even though the role grants it" — so it is
 * only meaningful against the role that was in force when it was made. Assigning a
 * role that grants a revoked permission therefore drops the revocation, which is
 * what makes `Create Deployment` return when QA replaces Engineer.
 *
 * Only permissions from roles that are NEW in this change are considered. A
 * revocation unrelated to the roles being added survives untouched, so an
 * administrator adding a second role does not silently undo unrelated exceptions.
 *
 * One consequence, deliberate: changing the role and removing something that role
 * grants, in the same save, will not stick — the rule grants it. Two saves does it.
 */
export function reconcileRevocations(input: {
  revoked: readonly string[]
  /** Permissions granted by roles present after the change but not before. */
  grantedByNewRoles: readonly string[]
}): string[] {
  const granted = new Set(input.grantedByNewRoles)
  return input.revoked.filter((key) => !granted.has(key))
}

/**
 * Where each effective permission came from, for an interface that has to explain
 * itself. `revoked` is reported separately because the UI shows it struck through
 * rather than absent — an administrator needs to see that it was deliberate.
 */
export type PermissionSource = 'role' | 'extra' | 'revoked' | 'none'

export function permissionSource(
  key: string,
  fromRoles: ReadonlySet<string>,
  overrides: PermissionOverrides,
): PermissionSource {
  if (overrides.revoked.includes(key)) return 'revoked'
  if (fromRoles.has(key)) return 'role'
  if (overrides.extra.includes(key)) return 'extra'
  return 'none'
}
