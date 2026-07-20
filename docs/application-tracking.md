# Application tracking

The built-in CRM tracks applications from scraped jobs and Gmail/manual origins. The application
row stores current state for fast display; its append-only event history records what actually
happened and powers analytics.

## Start tracking a scraped job

Find job IDs using scan output, JSON output, or SQLite, then run:

```bash
employed apply JOB_ID
employed apply JOB_ID --resume backend-v2
```

This creates an application linked to the job and appends its initial `applied` event. Repeating the
command returns the existing application instead of duplicating it. Résumé labels are free-form;
use consistent labels because `stats` compares outcomes by label.

Applications discovered through Gmail can be created without a job link. They behave identically
on the board and in event history; only score-band analytics exclude job-less applications.

## View the pipeline

```bash
employed board
```

The board groups applications into Applied, OA, Interview, Offer, and Rejected. Each row shows the
application ID, company, role, age since activity, and résumé label. Rejections are collapsed by
default so they do not overwhelm active work:

```bash
employed board --all
```

## Inspect one application

```bash
employed app APP_ID
```

The detail view shows company, role, current status, résumé, important timestamps, notes, and the
complete event timeline in chronological order. Gmail-generated and manual transitions use the
same event shapes; notes identify email provenance where relevant.

## Record a status change

```bash
employed move APP_ID oa
employed move APP_ID interview
employed move APP_ID offer
employed move APP_ID rejected
```

Valid statuses are:

- `saved`
- `applied`
- `oa`
- `interview`
- `offer`
- `rejected`

Transitions are advisory rather than restrictive. If a recruiter revives a rejected application,
employed warns that the transition is unusual but records reality. Every move updates current
status, appends the corresponding event, touches last activity, and sets first-response time once
for the first post-applied response.

## Add context without changing status

```bash
employed note APP_ID "Recruiter asked for availability next week"
```

A note appends a `note` event and updates last activity without changing application status.

## Job dismissal is different

```bash
employed dismiss JOB_ID
```

Dismiss means “do not show this discovered job again.” Rejected means “I applied and received a
negative outcome.” Dismissing a job does not delete or transition an application.

## Gmail updates

`employed sync` proposes or applies email-derived transitions through the same transition authority.
That guarantees manual and sync paths both maintain the event log. See
[AI providers and Gmail](ai-and-gmail.md) for retrieval, confidence, and approval behavior.

## How the event log affects analytics

Statistics scan events rather than counting only current statuses. For example, an application that
reached interview and was later rejected still counts toward interview rate. Keep all real status
changes in employed rather than editing SQLite directly, or the event history and analytics can
diverge.

## Suggested everyday workflow

```bash
employed new --band A,B
employed apply JOB_ID --resume general-v3
employed sync --days 7
employed board
employed app APP_ID
employed stats
```

Use `note` immediately after calls or recruiter conversations, and `move` as soon as a stage changes.
Accurate activity timestamps make follow-up and stale nudges useful.
