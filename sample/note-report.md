---
id: note-report
type: dossier
title: Note Report Test — Johnny Rico Profile
subject: [[johnny-rico]]
mission: [[mission-klendathu]]
status: drafting
date: 2026-05-31
created: 2026-04-02
---

# Note Report Test

Open this file, then run `Yamlink: Open Note Report` from the sidebar.

## What to verify in each tab

**Overview tab:**
- Briefing section shows `subject`, `mission`, `status`, `date`
- Signals section shows inbound/outbound link counts vs. vault average
- Role section shows an inferred role (this note has structured frontmatter relations, so it should read as a record/dossier type)
- "Likely missing" section shows fields common to other dossier notes that this one doesn't have

**Links tab:**
- Outgoing relations: `subject → johnny-rico`, `mission → mission-klendathu`
- Incoming relations: check if any notes link here (after linking this from another note)
- Unlinked mentions: if another note's body text contains "note-report" without a wikilink, it surfaces here

**Tasks tab:**
- Shows only the tasks written in this note
- Timeline shows this note's `date:` field and task due dates

**Views tab:**
- Suggested next view for this note type
- Any existing `!view` blocks in this note

**History tab:**
- Shows the structural arc: note created → type established → first link
- Full mutation event log below the arc

---

## Test: Arc Prediction

This note is missing some fields that other dossier notes typically have. Open Note Report → Overview tab. The "Likely missing" section should show candidate fields. Click `+` on any of them to insert it at the end of frontmatter.

## Test: Unlinked References

Open `roughnecks.md` and find the phrase "note-report" if it appears there in plain text (without a wikilink). That plain mention will appear in this note's Links tab under "Unlinked mentions".

---

- [ ] Review the Note Report layout on 2026-06-03 #medium
- [ ] Link this dossier in another note to test incoming relations #low
- [ ] Test the History arc after making a field change #urgent

---

!view dossier | All dossiers
select title, subject, status, date
sort date desc
