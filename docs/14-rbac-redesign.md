# 14 — RBAC redesign

Status: **Phase 1 implemented** (§14.2, §14.3). **§14.5C is reversed — see §14.7.**
Phases 2–4 outstanding. Refines [05-authorization.md](05-authorization.md).

Context: 5–20 users, one internal team, four projects, one organization.

---

## 14.1 The actual problem is not 50 permissions

The permission catalog is not what makes this system hard to use. The problem is
that **two independent access-control mechanisms exist and neither knows about the
other.**

**Mechanism 1 — the permission layer.** `can()`, `requirePermission()`,
`resolvePermissions()`, `satisfies()`. Roles carry permission strings; a request
context resolves them into a global set plus a per-project map. Roughly 300 lines,
29 unit tests, clearly documented. This is the designed system.

**Mechanism 2 — an ad-hoc membership filter.** Four call sites hardcode this into
their Prisma `where`:

```ts
memberships: { some: { userId: ctx.actorId, deletedAt: null } }
```

- `projects-service.listUserProjects` and `getProject`
- `deployments-service.memberScope` — applied to *every read and write*
- `all-deployments-service.listAllUserDeployments`
- `projects/[id]/templates/page.tsx`

Under mechanism 2, visibility means "a Membership row exists." Which role that
membership carries, and which permissions that role grants, are never consulted.

`projectFilter()` and `projectScopeFor()` — the functions written to be the bridge
between the two — **have zero callers.** So do `canOnAnyProject()` and the
`byProject` map they read.

### What this costs, today

The live database has **0 memberships, 3 users, 5 projects**. Therefore:

- `/projects` lists nothing, **for everybody including the super-admin**.
  `requirePermission(ctx, project.read)` passes on the wildcard, then the Prisma
  filter matches no rows.
- `/projects/[id]` calls `findFirstOrThrow` under the same filter and throws.
- No deployment can be opened or created — `memberScope` guards writes too.
- A global role grants permissions but **not visibility**. This is why "assign a
  project to a user" has no working answer.
- The only UI that could create a Membership (`/projects/[id]/members` →
  Add Member) links to a route that does not exist.

`can()` short-circuits on `isSuperAdmin`; a raw Prisma filter cannot. That
asymmetry is the whole bug: authorization was centralised, **visibility was not.**

### The one-line reframe

> Do not delete permissions. Delete the second mechanism.

---

## 14.2 Should project-level permissions be removed?

**Yes — stop enforcing them. No — do not delete the capability.**

Reasoning:

1. **The problem it solves is not yours.** Project scoping earns its complexity
   when an organization contains groups that must not see each other's work. One
   internal team of 5–20 people across four projects is the opposite case: the
   default expectation is that everyone can see everything, and every membership
   row is friction with no security benefit.
2. **It is already effectively unused.** No service consults `byProject`. Project
   grants exist in theory only.
3. **Removal is nearly free — if you remove the *enforcement*, not the schema.**
   Keep `Membership`, keep `byProject` in `resolvePermissions()`, keep the `scope`
   parameter on `can()`. Turning scoping back on later means *using*
   `projectFilter()` in list queries, not rebuilding a subsystem.
4. **Deleting the schema would be the expensive mistake.** `Membership`,
   `Role.isAssignableGlobally` and `Role.isAssignableOnProject` are the hooks that
   make multi-project or multi-tenant scoping a configuration change later. They
   cost one dormant collection.

So: **org-wide roles are the only enforced scope. The project-scoped path stays in
the code, unused, ready.**

### The change that does it

Replace each hardcoded membership filter with the function already written for it:

```ts
// before — membership is visibility; permissions ignored; super-admin excluded
where: {
  organizationId: ctx.organizationId,
  deletedAt: null,
  memberships: { some: { userId: ctx.actorId, deletedAt: null } },
}

// after — permission is visibility
where: {
  organizationId: ctx.organizationId,
  deletedAt: null,
  ...projectFilter(ctx, PERMISSIONS.project.read, 'id'),
}
```

`projectScopeFor()` returns `null` for a global grant or super-admin, and
`projectFilter()` turns that into `{}` — every project. A user holding only
project-scoped grants gets `{ id: { in: [...] } }`. A user with neither gets
`{ id: { in: [] } }`, which MongoDB matches against nothing.

Field name is `'id'` on `Project` and `'projectId'` on `DeploymentRun`.

This single change:

- makes global roles actually grant access
- makes the super-admin see the org
- keeps per-project scoping available at zero cost
- deletes mechanism 2

---

## 14.3 Roles

Four roles. Design them around **decisions a person is trusted to make**, not
around resources they touch — resources are what permissions are for.

The current five (`admin`, `developer`, `qa`, `devops`, `release-manager`) overlap
heavily: `developer`, `devops` and `release-manager` differ mainly in who may close
a release and touch production, which is two permissions, not three roles.

### Admin — `*`

`permissions: ['*']`, `isSuperAdmin: true`, `isSystem: true`. Unchanged.

The wildcard is correct **here and nowhere else**: the bootstrap role must never be
missing a permission added later, or a new feature becomes unreachable with no way
back in. `scripts/grant-super-admin.ts` documents this.

### Release Manager — owns templates, the gate, and production

```
project.read, project.edit, project.template.assign
template.read, template.manage, template.publish, template.deprecate
deployment.read, deployment.create, deployment.edit, deployment.start,
deployment.complete, deployment.fail, deployment.cancel, deployment.rollback,
deployment.export, deployment.production
deployment.execute, deployment.item.skip, deployment.item.uncheck_other
comment.read, comment.create, comment.edit_own, comment.moderate
admin.access, audit.read, environment.manage, settings.read,
notification.read, notification.retry
```

Deliberately absent: `role.manage`, `user.*`, `settings.manage`, `project.delete`,
`project.create`, `template.delete`, `deployment.delete`. Destructive and
identity-granting actions stay with Admin — this role ships software, it does not
administer the organization.

`admin.access` is required because templates live under `/admin/templates`; every
admin page checks it.

### Engineer — runs non-production releases end to end

```
project.read
template.read
deployment.read, deployment.create, deployment.edit, deployment.start,
deployment.complete, deployment.fail, deployment.cancel, deployment.export
deployment.execute
comment.read, comment.create, comment.edit_own, comment.delete_own
```

Deliberately absent: `deployment.production`, `deployment.rollback`,
`deployment.item.skip`, `deployment.item.override`.

**This role gets `deployment.complete`, departing from the current `developer`.**
Reasoning: `deployment.production` is checked *in addition to* the requested
permission whenever the target environment is flagged `isProduction`
([authorize.ts](../src/lib/authz/authorize.ts) — `AuthorizeScope`). So an Engineer
already cannot perform **any** action on a production run. Withholding `complete`
therefore adds no production safety; it only forces a second person to close every
staging run. For a team of this size that is friction without benefit.

Keep the four-eyes split only if closing a *non-production* release is a decision
you genuinely want reviewed. It is a one-line change either way.

### Viewer — read-only

```
project.read, template.read, deployment.read, comment.read
```

New, and the most useful addition. Managers, stakeholders and new joiners need to
watch a release without any possibility of altering it. There is currently no role
that expresses this, so such people get `qa` or nothing.

Add `deployment.export` only if stakeholders should be able to pull history as CSV.

### QA — optional fifth

```
project.read, template.read, deployment.read, deployment.execute
comment.read, comment.create, comment.edit_own
```

Keep this **only if** you need someone who verifies items but must not create or
close runs. At 5–20 people that distinction is usually organizational rather than
technical, and Engineer covers it. Start with four roles; add QA when someone asks.

### Summary

| | Admin | Release Manager | Engineer | Viewer |
|---|---|---|---|---|
| See projects / templates / runs | ✓ | ✓ | ✓ | ✓ |
| Tick checklist items | ✓ | ✓ | ✓ | — |
| Create / start a run | ✓ | ✓ | ✓ | — |
| Close a run | ✓ | ✓ | ✓ (non-prod only) | — |
| Production environments | ✓ | ✓ | — | — |
| Skip items, roll back | ✓ | ✓ | — | — |
| Edit / publish templates | ✓ | ✓ | — | — |
| Manage users and roles | ✓ | — | — | — |
| Org settings | ✓ | read | — | — |

---

## 14.4 Wildcards: use for Admin only

`satisfies()` walks prefixes right to left, so `deployment.item.skip` matches
`deployment.item.*` and then `deployment.*`.

**Avoid them in ordinary roles.** The decisive argument is not breadth, it is
**non-determinism across code changes**: a role holding `deployment.*` silently
gains every permission added to that resource in future. Add
`deployment.force_complete` to the catalog next quarter and every `deployment.*`
holder has it, retroactively, with no audit entry and no review. A role should mean
the same thing tomorrow as today.

Concretely, `deployment.*` today already includes `production`, `delete`,
`rollback` and `item.override` — four of the ⚠ dangerous permissions. Any role
built that way cannot express "everything except production", which is exactly the
distinction Engineer exists to make.

**Use `*` for the super-admin role**, for the inverse reason: that role must gain
new permissions automatically, or a new feature locks everyone out.

Narrow wildcards (`comment.*`) are defensible but buy little — five explicit
strings versus one, and it silently includes `moderate`. Not worth the precedent.

The tedium wildcards would relieve is a **UI** problem. Fix it in the role editor
(§14.5), not in the grant semantics.

---

## 14.5 UX: administrators see roles, not permissions

Three screens, in priority order.

### A. Users list with inline actions — highest value

`admin/users` is currently a read-only table (Name, Email, Status, Joined) with no
Actions column, so **roles can only be set at invite time** and there is no way to
resend or revoke an invitation. This is the friction the team actually feels.

Add an Actions column:

| Action | Backing code | State |
|---|---|---|
| Change role | `updateUser` action | exists, unwired |
| Resend invitation | `invitationService.resend()` | exists, no action, no UI |
| Revoke invitation | `invitationService.revoke()` | exists, no action, no UI |
| Suspend / Restore | `usersService` | partly exists |

Changing a role must be **one select of role names** — never a permission grid.
An administrator picks "Engineer"; the permissions are the role's business.

This works immediately once §14.2 lands, because a role change takes effect on the
user's next request: `getRequestContext()` resolves permissions per request and
never carries them on the JWT.

### B. Role editor: grouped, described, copyable

The data for a good editor already exists and is unused. `PERMISSION_GROUPS`,
plus `label` / `description` / `dangerous` / `globalOnly` on every
`PermissionDefinition`, plus the `PermissionDefinition` collection seeded from code
"so the admin role editor can group and describe permissions without hardcoding a
list in the UI."

So render: **7 collapsed sections, ~7 checkboxes each**, description as helper
text, a warning affordance on `dangerous`, and `globalOnly` disabled when editing a
project-assignable role. Add **"Duplicate role"** so a new role starts from an
existing one rather than 50 unchecked boxes.

Nobody sees 50 permissions unless they deliberately open a role and expand a
section. That satisfies "administrators should not need to understand 50
permissions" without removing any.

### C. Project access: delete the dead ends, do not build them

> **Reversed. See [§14.7](#147-reversal-project-assignment-is-the-access-mechanism).**
> Kept as written because the reasoning below was sound for the requirement it was
> answering, and the reversal only makes sense against it.

With §14.2 in place, project membership no longer controls anything. So:

- **Delete** the Add Member and Edit buttons on `/projects/[id]/members` — both
  currently 404.
- Either drop the page or keep it read-only, stating that access is org-wide.

Ordering matters here: building the two missing member pages *and then* switching
project scoping off would be wasted work. Do §14.2 first, and the pages are never
needed.

---

## 14.6 Schema changes: none required

This is a genuine strength of the existing design — the redesign is a wiring and UI
change, not a migration.

Keep exactly as-is: `Role.permissions String[]`, `User.roleIds String[]`,
`Membership`, `Role.isAssignableGlobally`, `Role.isAssignableOnProject`,
`PermissionDefinition`.

**Do not** denormalise resolved permissions onto `User`. It would break instant
role changes, which currently work because permissions are resolved per request
rather than carried on the JWT — the same property `sessionEpoch` exists to
protect, and that `grant-super-admin.ts` relies on when it deliberately does *not*
bump the epoch.

One **data** change, not schema: the seed creates no `Membership` rows. Under this
design it should not need to. If §14.2 is deferred, the seed must create memberships
for the admin or the app is unusable on a fresh install.

---

## 14.7 Is the architecture over-engineered?

Split the verdict.

**The permission engine: no.** `satisfies` / `can` / `resolvePermissions` /
`requirePermission` is about 300 lines with 29 tests, and roles-as-data with a
code-owned catalog is the standard shape for any application with roles. Replacing
it with hardcoded role checks would be a downgrade, and the lint rule forbidding
`role === 'admin'` is what keeps it honest.

**The unused generality: yes, mildly.** `projectFilter`, `projectScopeFor`,
`canOnAnyProject`, `AuthorizeScope.isProductionEnvironment`,
`Role.isAssignableOnProject`, `GLOBAL_ONLY_PERMISSIONS` — built ahead of need. But
dormant code that is already written and tested is cheap to keep and expensive to
rebuild, and §14.2 promotes three of those from unused to load-bearing.

**The real waste: two mechanisms for one job.** That is not over-engineering, it is
an inconsistency — and it is the thing to delete.

The correct move is therefore *not* to simplify the engine. It is to **finish
connecting it**, hide it behind roles in the UI, and leave project scoping switched
off by not using it.

---

## 14.8 Sequencing

**Phase 1 — unblock. DONE.** The four membership filters now go through
`projectFilter`; the dead Add Member / Edit buttons are gone; the seeded roles are
the five in §14.3; `0006-consolidate-seed-roles` moves existing organizations over.

Verified: all five projects are now visible at `/projects` to a signed-in
administrator, where the same request previously returned none. 61 unit tests pass,
12 of them new in `tests/unit/seed-roles.test.ts` pinning the role design and the
org-wide visibility contract.

`0006` deliberately **keeps** a retired role that is still assigned to somebody,
because every candidate successor grants strictly more or strictly less than what
the holder had, and no automatic remap is safe. That leaves a manual step —
reassign the holder — and `0007-retire-superseded-roles` then completes the
retirement. It is `alwaysRun`, because the runner skips anything already recorded,
so a once-only `0006` could never come back and finish the job. `0007` only ever
soft-deletes an unheld role and never touches permissions, which is what makes it
safe to repeat.

Until §14.5A ships, `npm run set:role -- <email> <role-key>` is the supported way
to change someone's role. It replaces rather than unions, so a reassignment does
not leave the superseded role attached and still granting.

Final state on this database: **admin, release-manager, engineer, qa, viewer**
active; `developer` and `devops` retired; every user on a current role.

**Phase 2 — user management.** Actions column on `admin/users`: change role, resend,
revoke, suspend/restore. Server actions over the existing service methods.

**Phase 3 — role editor.** Grouped sections, descriptions, danger affordances,
Duplicate role.

**Phase 4 — only if needed.** Re-enable project scoping: grant roles on
memberships and let `projectFilter` narrow. No schema change, no migration.

Phase 1 is the one that matters. Everything else is polish on a system that, until
it lands, cannot show a single project to a single user.

---

## 14.7 Reversal: project assignment IS the access mechanism

**Supersedes §14.5C. Phase 4 above is now implemented.**

The requirement changed: an administrator assigns specific projects to a user, and
that user sees only those. §14.5C assumed access would stay organisation-wide, so it
removed the two member-management buttons rather than building them. That assumption
no longer holds, so the buttons are real and `/projects/[id]/members` manages
`Membership` again.

### What already worked, and what did not

The authorization half needed nothing. `projectScopeFor` / `projectFilter` have
always narrowed to the projects where an actor holds the permission, returning
`{ in: [] }` for an actor with none — the correct empty result rather than an
unfiltered query. `resolvePermissions` reads `Membership` per request, so a grant or
revocation takes effect on the next navigation with no session bump and no re-login.

What did *not* work, and is the reason this path could be described as "dormant"
rather than "unused": **seven service guards called `requirePermission` with no
scope.** `can()` with no scope consults only the global grant set, so every one of
them rejected the users project scoping exists for — *before* the correctly-written
filter on the next line could return the rows they were entitled to. A user assigned
to one project could not list projects at all.

The fix is a distinction, now explicit in the helper names:

- **`requireAnyProject(ctx, permission)`** — coarse gate for a read that then narrows
  itself. "Do they hold this anywhere?" Pair it with `projectFilter` in the query,
  which does the precise scoping. Never use it alone to protect a single entity.
- **`requirePermission(ctx, permission, { projectId })`** — exact check, for when the
  project is named by the caller.

`visibleNavigation` had the same flaw and the same fix, via `anyProject` on a nav
item: otherwise a user assigned to a project loses the link to it. Administration
items deliberately do **not** get this — admin authority is organisation-wide by
nature, and a project grant must never light up an admin link.

### The trap that makes assignment decoration

An organisation-wide role carrying `project.read` satisfies the permission
everywhere, so `projectScopeFor` short-circuits to "every project" and assignments
mean nothing. Four of the five seeded roles do exactly that — Release Manager,
Engineer, QA and Viewer all include it.

The seeded roles were deliberately **not** re-flagged. They are bundles: Release
Manager also carries `environment.manage`, `settings.read` and template permissions,
which are organisation-level duties, and making the role project-only would strip
them. Instead the distinction is surfaced where the decision is made — the org-wide
role picker marks such roles **all projects**, and the user's Project access panel
warns when one is held. To restrict someone to specific projects, leave those roles
unticked and assign projects instead. `UpdateUserSchema.roleIds` has no minimum, so
an administrator can hold zero org-wide roles.

`Role.isAssignableOnProject` is now read for the first time: a role flagged
organisation-only cannot be granted on a project, or project assignment would become
a way to hand out org-wide authority one project at a time.

### Still organisation-wide by design

Templates, environments, settings, roles, users and the audit log. Only projects and
their deployments are project-scoped. Extending scoping further would need the same
guard audit as above — the pattern to look for is `requirePermission` with no scope
sitting above a `projectFilter`.
