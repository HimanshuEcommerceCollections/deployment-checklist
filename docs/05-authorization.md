# 5 — Authorization

Code: [src/lib/authz/permissions.ts](../src/lib/authz/permissions.ts) (the catalog) and [src/lib/authz/authorize.ts](../src/lib/authz/authorize.ts) (the engine).

---

## 5.1 What "not hardcoded" means here

The requirement is *"avoid checking roles directly inside business logic"* and *"permissions should not be hardcoded"*. Those pull in slightly different directions if read literally, so here is the resolution the system implements:

| Thing | Where it lives | Changing it requires |
|---|---|---|
| Permission **strings** | code (`permissions.ts`) | a release |
| Permission **metadata** (label, group, description, danger flag) | code → seeded to `PermissionDefinition` | a release |
| **Roles** | `roles` collection | data entry |
| **Role → permission mapping** | `Role.permissions[]` | data entry |
| **Grants** (who has which role, where) | `User.roleIds`, `Membership` | data entry |
| **Checks** | `can(ctx, PERMISSIONS.x, scope)` | never mention a role |

Permission strings must be code because code references them — a permission invented at runtime can never be enforced by anything. What must never be hardcoded, and here is not, is the *mapping* from role to permission and the *check itself*.

The practical test: creating a **Release Manager** role that can publish templates and complete production deployments is a form submission in the admin UI. Zero code, zero deploy, zero migration. That is the property the requirement is actually after.

An ESLint rule fails the build on any comparison against a role identity, so the guarantee does not decay:

```js
'no-restricted-syntax': ['error', {
  selector: 'BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression[property.name=/^(role|roleKey|roleName|roles)$/]',
  message: 'Never branch on role identity. Use can(ctx, PERMISSIONS.x, scope).',
}],
```

---

## 5.2 Two-dimensional grants

Permissions are held **globally** (org-wide) or **per project**. Same user, different authority depending on where they are:

```
Priya
├── global roleIds: [ Developer ]              ─── Developer everywhere
└── memberships:
      ├── { project: Apex,    role: Release Manager }   ─── can publish + complete on Apex
      └── { project: Website, role: QA }                ─── can only tick items on Website

Effective on Apex     = Developer ∪ Release Manager
Effective on Website  = Developer ∪ QA
Effective on Elevate  = Developer
```

Resolution order in `can()`:

```
1. isSuperAdmin (any role holding "*")           → allow
2. production escalation, if the env is prod     → also require deployment.production
3. global permissions satisfy?                   → allow
4. permission is globalOnly?                     → DENY (project grants cannot confer it)
5. project permissions for scope.projectId?      → allow
6. otherwise                                     → deny
```

Step 4 is a safety valve worth calling out. `settings.manage` and `user.invite` are marked `globalOnly`. If an admin mistakenly adds `settings.manage` to a project-assignable role, being a member of one project does **not** become a path to editing SMTP credentials. Configuration mistakes should fail closed.

Step 2 turns "who may touch production" into pure configuration. `deployment.create` scoped to a `production` environment additionally requires `deployment.production`. So *Developer can deploy freely to staging, but not to production* needs no `if (env === 'production')` anywhere in the codebase.

---

## 5.3 Wildcards

Three grant forms, deliberately no more:

| Grant | Matches |
|---|---|
| `*` | everything (super-admin only) |
| `deployment.*` | every permission whose resource prefix is `deployment` |
| `deployment.create` | exactly that |

Prefix wildcards are matched right-to-left, so `deployment.item.skip` is satisfied by `deployment.item.*` and by `deployment.*`. There is deliberately **no** `*.create` or general glob: a role editor showing "this role can create… things?" is unreviewable, and an over-broad grant nobody can reason about is worse than a few extra checkboxes.

---

## 5.4 Enforcement points

### Service layer — the one that matters

```ts
// src/features/deployments/server/deployment-service.ts
async completeRun(ctx: RequestContext, runId: string, input: CompleteRunInput) {
  const run = await this.repo.findForTransition(runId)
  if (!run) throw new NotFoundError('DeploymentRun', runId)

  requirePermission(ctx, PERMISSIONS.deployment.complete, {
    projectId: run.projectId,
    isProductionEnvironment: run.isProduction,
  })

  // Domain guard — separate concern from authorization, and equally mandatory.
  const readiness = evaluateReadiness({ snapshot: run.checklist, states, policy })
  if (readiness.state !== 'GO') {
    throw new PreconditionFailedError('CHECKLIST_INCOMPLETE', {
      outstanding: readiness.outstanding.map((i) => i.label),
    })
  }
  …
}
```

Every service method starts this way. It is redundant with the page-level and action-level checks above it, and that redundancy is the point: it is the layer no transport can bypass, and it protects the method equally whether the caller is a page, a Server Action, a REST client, or next year's Slack bot.

### Query-level scoping

Authorization that filters *after* fetching is a data leak waiting for a pagination bug. Lists narrow the query itself:

```ts
// src/features/deployments/queries/list-runs.ts
export async function listRuns(ctx: RequestContext, filters: RunFilters) {
  requirePermission(ctx, PERMISSIONS.deployment.read)   // do they have it anywhere?

  return db.deploymentRun.findMany({
    where: {
      ...projectFilter(ctx, PERMISSIONS.deployment.read),   // {} | { projectId: { in: [...] } }
      ...buildFilters(filters),
    },
    select: RUN_LIST_SELECT,
    orderBy: parseSort(filters.sort),
    take: filters.limit,
  })
}
```

`projectFilter` returns `{}` for a global grant and `{ projectId: { in: [...] } }` otherwise — including `in: []` when the actor has no grants, which matches nothing. Returning `{}` in that case would show every row to a user with no access; it is the single most common broken-authorization bug in applications shaped like this one, and it is why the empty case is handled explicitly in [authorize.ts](../src/lib/authz/authorize.ts).

### Page level

```tsx
// src/app/(admin)/admin/layout.tsx — one gate for the whole admin tree
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.admin.access)
  return <AdminShell nav={visibleAdminNav(ctx)}>{children}</AdminShell>
}
```

`visibleAdminNav(ctx)` filters navigation by permission, so a QA user never sees a *Settings* link that would 403. Navigation is generated from the permission set, not hand-maintained.

### Client components

The server sends **answers**, not rules:

```tsx
// server component
const abilities = serializeAbilities(ctx, [
  { key: 'canExecute',  permission: PERMISSIONS.deployment.execute,  scope: { projectId } },
  { key: 'canComplete', permission: PERMISSIONS.deployment.complete, scope: { projectId, isProductionEnvironment } },
  { key: 'canSkip',     permission: PERMISSIONS.deployment.itemSkip, scope: { projectId } },
])

return <DeploymentConsole run={run} abilities={abilities} />
```

```tsx
// client component
<Can ability="canComplete" abilities={abilities}>
  <CompleteButton />
</Can>
```

No permission logic and no role data reaches the client bundle. Client checks only hide affordances; the Server Action behind `<CompleteButton>` re-checks, because a hidden button is a UX decision and not a security control.

### Every layer, at a glance

| Layer | Purpose | Bypassable? |
|---|---|---|
| Navigation filter | don't show dead ends | yes — cosmetic |
| `<Can>` in client components | hide affordances | yes — cosmetic |
| Page / layout guard | fail fast with a good error page | yes — via a direct action call |
| Server Action / route handler | transport boundary | yes — via another transport |
| **Service method** | the actual authorization | **no** |
| Query scoping | prevents leaking rows the actor may not see | **no** |

---

## 5.5 Row-level rules beyond permissions

Some rules are not "does this actor hold permission X" but "may this actor do X *to this thing, right now*". Those belong in the domain layer as policies, next to the state machine, not smuggled into the permission catalog.

```ts
// src/domain/deployments/policies.ts — pure
export function canUncheckItem(input: {
  actorId: string
  state: { checkedById: string | null }
  runStatus: DeploymentStatus
  hasUncheckOther: boolean
}): PolicyResult {
  if (input.runStatus !== 'IN_PROGRESS')
    return deny('RUN_NOT_IN_PROGRESS', 'Items can only be changed while a run is in progress.')
  if (input.state.checkedById && input.state.checkedById !== input.actorId && !input.hasUncheckOther)
    return deny('NOT_ITEM_OWNER', 'Only the person who ticked this item can untick it.')
  return allow()
}
```

Currently implemented policies:

| Policy | Rule |
|---|---|
| `canUncheckItem` | run must be `IN_PROGRESS`; only the ticker may untick unless `deployment.item.uncheck_other` |
| `canEditRun` | only in `DRAFT` or `IN_PROGRESS`; terminal runs are read-only for everyone |
| `canCompleteRun` | readiness gate must be `GO` under the snapshot's `completionPolicy` |
| `canCheckItem` | `evidenceRequired` items need a note unless `deployment.item.override` |
| `canEditTemplateVersion` | a `PUBLISHED` version is frozen; editing clones it to a `DRAFT` |
| `canDeleteRole` | `isSystem` roles are undeletable; a role with grants must be reassigned first |
| `canSuspendUser` | nobody may suspend themselves; the last super-admin cannot be suspended |

Policies return a structured reason, which the UI renders as *why* a button is disabled. "Complete deployment" greyed out with no explanation generates support tickets; greyed out with *"3 required items outstanding in Testing"* does not.

The last super-admin rule deserves emphasis. Without it, an admin removing their own privileges leaves an organisation with no one who can grant them back — recoverable only by direct database access. It is checked in `RoleService.update`, `UserService.suspend`, and `UserService.delete`.

---

## 5.6 Testing

Authorization is the part of this system where a bug is a breach, so it gets the heaviest test coverage. Domain-layer purity makes that cheap — no database, no HTTP.

```ts
// tests/unit/authz/satisfies.test.ts
describe('satisfies', () => {
  it('grants everything on the super wildcard', () =>
    expect(satisfies(new Set(['*']), 'settings.manage')).toBe(true))

  it('matches nested prefixes right to left', () => {
    expect(satisfies(new Set(['deployment.item.*']), 'deployment.item.skip')).toBe(true)
    expect(satisfies(new Set(['deployment.*']), 'deployment.item.skip')).toBe(true)
  })

  it('does not match across resources', () =>
    expect(satisfies(new Set(['deployment.*']), 'template.publish')).toBe(false))

  it('has no suffix globs', () =>
    expect(satisfies(new Set(['*.create']), 'project.create')).toBe(false))
})

// tests/unit/authz/can.test.ts
it('refuses globalOnly permissions granted via a project role', () => {
  const ctx = contextWith({ project: { p1: ['settings.manage'] } })
  expect(can(ctx, 'settings.manage', { projectId: 'p1' })).toBe(false)
})

it('requires deployment.production on production environments', () => {
  const ctx = contextWith({ global: ['deployment.create'] })
  expect(can(ctx, 'deployment.create', { projectId: 'p1' })).toBe(true)
  expect(can(ctx, 'deployment.create', { projectId: 'p1', isProductionEnvironment: true })).toBe(false)
})

it('returns an empty scope, never a global one, for an actor with no grants', () => {
  expect(projectScopeFor(contextWith({}), 'deployment.read')).toEqual([])
  expect(projectFilter(contextWith({}), 'deployment.read')).toEqual({ projectId: { in: [] } })
})
```

Two conformance tests keep the surface honest as it grows:

**Every permission is enforced somewhere.** A static check asserts that each key in `PERMISSION_DEFINITIONS` appears in at least one `requirePermission` / `can` call. A permission nothing checks is a false promise in the admin UI.

**Every mutating service method authorizes.** A test walks the exported methods of each `*-service.ts`, and fails on any mutating method whose body contains no `requirePermission` / `requireAny` / `requireOwnershipOr` call. Crude — it is an AST grep — but it catches the one mistake that matters most, and it catches it on the pull request rather than in production.

---

## 5.7 Extending

| Requirement | Change |
|---|---|
| New role (QA, DevOps, Product, Release Manager) | admin UI. No code |
| New permission | add to `PERMISSION_DEFINITIONS`, re-seed, grant. Enforce it at the service |
| Teams as a grant target | add `Team` + `TeamMembership`; `resolvePermissions` gains one union term. `can()` unchanged |
| Environment-scoped roles beyond production | generalise `isProductionEnvironment` into `environmentKey` in `AuthorizeScope`, and add `Membership.environmentKeys` |
| Deny rules / negative permissions | **not recommended.** Order-dependent deny lists are notoriously hard to reason about. Model the exception as a narrower role instead |
| Attribute-based rules (own-project-only, time windows) | the `policies.ts` layer. Keep it out of the permission catalog |
| Approval chains | new `PENDING_APPROVAL` state + `Approval` records + `deployment.approve` permission. The gate function already exists |
| Multi-org | `organizationId` is already on every row and leads every index; `resolvePermissions` is already scoped by it |
