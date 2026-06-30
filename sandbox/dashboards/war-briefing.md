---
id: war-briefing
type: dashboard
title: War Briefing
created: 2026-06-21
summary: Concise high-level dashboard for Yamlink Sandbox
---

# Overview

This dashboard is intentionally tighter than [[command-hub]].

Use it when you want Yamlink to feel like a briefing layer instead of a command console.

## Campaign Snapshot

!view campaign
sort target_date asc

## Next Operation

!view mission
where status = scheduled
sort date asc

## Key Personnel

!view character
sort rank asc
