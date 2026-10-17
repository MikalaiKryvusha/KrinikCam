# team-ci — the CI workflow that ships with the team

> Template from the KAIF `team-deployment` skill (operation 3, step 6; the owner's order in
> origin issue #29: "CI must ship together with the team deployment"). Copy the fenced block
> below to `.github/workflows/team-ci.yml` of the project — by the owner's yes, like every
> artifact of operation 3 — and fill every `<angle-bracket>` placeholder.

## Constraints (state them in the constitution § 5; keep them here)

1. **Cheap gates only** — units, lint, typecheck. No secrets, no emulators, no live stand, no
   device: heavy dynamic checks stay LOCAL behind the stand lock (constitution § 7).
2. **Commands are READ, never guessed** — take them from `package.json` scripts or the project's
   build canon (`AGENT_GUIDE.md`). An unknown command stays a named placeholder for the owner: a
   job that runs the wrong command is worse than no job (a false green).
3. **Red blocks the merge** — a red run on a role branch blocks the merge request the same way a
   missing verifier's verdict does; the Manager merges nothing red (constitution § 5).
4. **Non-GitHub remote** — the same job runs as a documented local pre-push script named in
   constitution § 5; the capability degrades gracefully, never silently.
5. **One job, at most three gate steps** — a team CI that grows into a pipeline belongs to the
   project's own CI canon, not to this template.

## The workflow

```yaml
name: team-ci
on:
  push:
    branches: ['main', '<project>-team-*']   # the role-branch pattern of the naming invariant (§ 1)
  pull_request:
    branches: ['main']
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4            # <replace with the project's toolchain setup action>
        with: { node-version: '<major from .nvmrc / engines>', cache: npm }
      - run: npm ci                            # <the project's install command>
      - run: <unit-test command>               # gate 1 — from package.json / the build canon
      - run: <lint command>                    # gate 2
      - run: <typecheck command>               # gate 3 — drop the line if the stack has none
```

## Local pre-push (non-GitHub remotes)

`<pre-push command>` — the same three gates in the same order, wired as the repository's
`pre-push` hook or the project's documented script; constitution § 5 names it so no seat can
claim the check did not apply to it.
