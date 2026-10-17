# House rules — <PROJECT NAME>

> **How to use this file.** COPY it to the project root on first use —
> `cp .kaif/_house-rules-template.md HOUSE_RULES.md` — then fill the copy and delete the sections
> this project does not need; never fill this template in place. The owner reads this file, so the
> copy is written in the project's working language (`.kaif/kaif.json` → `language`), headings
> included. First use is whichever comes first: the owner gives a standing working rule
> (`/fix-vision` step 3) · the agent records a route, a recipe or a convention it will need again ·
> a re-read core document crosses its size budget and a project-subject section has to move out.
>
> **What belongs here.** Tier 4 of the document taxonomy (`AGENT_GUIDE.md`): local law that governs
> this project and travels nowhere. `AGENT_GUIDE.md` answers HOW the agent works (the KAIF method);
> this file answers WITH WHAT it works here — the owner's standing rules, the systems, stands,
> devices, routes, tools and product facts of THIS project. It is outside the nine re-read core
> documents and has no size budget; `/resume` reads it at session entry, and the context router
> sends a task on a surface the project already touched here first.

**Created:** <date> · **Owner:** <name> · **Moved here from the guide:** <section → date, or "nothing yet">

## 1. The owner's standing rules

Each rule is a strict rule in the agent's wording — imperative, numbered, its exceptions named — with
ONE provenance line. The owner's verbatim words stay at their source (the commit that recorded them
verbatim first, the interview, the decisions log); a block of raw chat messages here is a defect
(`AGENT_GUIDE.md` → "The rulebook takes the rule, not the quote").

### R1. <rule title — what to do, as a command>

1. <step, imperative>
2. <step, imperative>
- **Exception:** <when the rule does not apply — or none>

[OWNER] <date and time> · <where the verbatim lives: commit <hash> · interview #NNN, QN · decision #NN>

## 2. External systems and access

| System | What the agent does there | Entry point (URL, CLI, API) | Where the credentials live |
|---|---|---|---|
| <tracker / stage / prod / analytics> | <read · write · deploy> | <address> | <secret store or env var — NEVER the secret itself> |

## 3. Stands, environments and devices

The commands of the test harness live here, one row each — the stand or device the command drives, what it is for, the
command itself in "How the agent reaches it", its known traps; the project's harness guide, if it has one, gets a row too
(`AGENT_GUIDE.md` → "Test harness").

| Stand / device | What it is for | How the agent reaches it | Known traps (with the lesson id) |
|---|---|---|---|
| <stage · prod · emulator · phone> | <purpose> | <command> | <EXP-NNNN or "none known"> |

## 4. Environment dossier — the facts of the machine

The rule — `AGENT_GUIDE.md` → "Environment dossier"; `/refresh-context` regenerates this table (its dossier step). Probe six
axes, and probe them **in every shell available separately** — different shells are different worlds:

1. **OS / hardware** — OS version, CPU cores, RAM.
2. **Shells and encodings** — which shells exist, console codepage, the default ANSI encoding a
   redirect writes, each shell's locale.
3. **Toolchain** — language runtimes, package/build tools, VCS and their versions; and WHAT
   `tar` / `curl` / `find` resolve to in each shell (a system binary, a GNU tool, or a shell
   alias to something else entirely — check the command TYPE, not just its path).
4. **VCS policies** — line-ending policy, credential helper.
5. **Package managers** — what is available to install with.
6. **Behavioural quirks** — LINKS to the lessons already paid for (`EXPERIENCE.md` ids), never
   copies of them.

Write one row per fact: **fact → value → probe command**. A fact never probed is written `— not probed yet —`: a missing
fact is honest, an invented one is a defect (`PHILOSOPHY.md` → the three doors).

> **Environment dossier.** Taken: `<date>` · Regeneration: `/refresh-context` → the dossier step
> (re-run the probes in column 3 and rewrite the values and this date) · **Staleness: facts older
> than four weeks are HYPOTHESES — re-probe before relying on them.**

| Fact | Value | Probe |
|---|---|---|
| OS | `— not probed yet —` | (the OS version command of this platform) |
| CPU / RAM | `— not probed yet —` | |
| Shells available | `— not probed yet —` | |
| Console / ANSI encoding | `— not probed yet —` | |
| Locale per shell | `— not probed yet —` | |
| Runtimes and build tools | `— not probed yet —` | |
| `tar` / `curl` / `find` per shell | `— not probed yet —` | |
| VCS line-ending policy | `— not probed yet —` | |
| Package manager | `— not probed yet —` | |
| Quirks paid for by incidents | `— not probed yet —` | (links to `EXPERIENCE.md` ids) |

## 5. Routes, recipes and conventions — the index of own work

Where the project's accumulated work lives: step files, device routes, recorded recipes, style
measurements of the project's own texts. A task on a surface listed here starts by opening the entry
and citing it (`AGENT_GUIDE.md` → checklist step 2).

| Surface | Where the work lives | What it covers |
|---|---|---|
| <feature / screen / procedure> | <path> | <one line> |
| Push and forge authentication | <the command, e.g. `gh auth setup-git`> | how pushing is authenticated here; non-fast-forward → `git pull --rebase` → retry (`AGENT_GUIDE.md` → "Push / GitHub authentication") |

## 6. Tools of this project

Every automation tool of the project (build, commit, release, codegen, graphics…) — a row the day it is added
(`AGENT_GUIDE.md` → "Tools").

| Command | What it does | What it guards |
|---|---|---|
| `<command>` | <one line> | <the defect class it catches, or "—"> |

## 7. Product knowledge

<Domain facts the agent needs and must not re-derive: the glossary, the entities and their roles, the
numbers that must not change. A fact the owner owns carries the owner's provenance line, like a rule.>
