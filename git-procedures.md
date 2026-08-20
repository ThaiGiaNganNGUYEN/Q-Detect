GIT PROCEDURES (Gitflow Workflow)
================================

Purpose
-------
This document defines our Git branching and release procedures using Gitflow.

Core Branches
-------------
1) main
   - Production-ready code only.
   - Every commit on main must correspond to a released version.
   - Protected branch (no direct commits; PR/MR required).

2) develop
   - Integration branch for ongoing development.
   - Contains completed features for the next release.
   - Protected branch (no direct commits; PR/MR required).

3) release
    - When enough features are developed and ready for release.
    - Branches off develop
    - A state for only bug fixes, documentation and other release-oriented tasks
    - Once ready, merged back into develop

Supporting Branches
-------------------
A) feature/*  (new work / enhancements)
B) release/*  (release preparation / stabilization)
C) hotfix/*   (urgent production fixes)

Naming Conventions
------------------
- feature/<short-description>        e.g., feature/login-ui
- release/<version>                  e.g., release/1.4.0
- hotfix/<version-or-issue>          e.g., hotfix/1.4.1 or hotfix/fix-crash-on-start

General Rules
-------------
- Always branch from the correct base branch.
- - E.g.: when developing a function, create a feature branch from develop
- Keep branches small and focused.
- Commit frequently with clear messages.
- Open PR/MR early if useful, but merge only when ready.
- Never rewrite shared history (avoid force-push on shared branches).

Local Setup (once)
------------------
1) Clone repository:
   git clone <repo-url>
   cd <repo-folder>

2) Ensure you have the latest branches:
   git fetch --all --prune