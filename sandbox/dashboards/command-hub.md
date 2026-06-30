---
id: command-hub
type: dashboard
title: Command Hub
created: 2026-06-21
summary: Primary operational dashboard for Yamlink Sandbox
---

# Overview

This is the fastest place to test Yamlink views in the sandbox.

Use it to compare broad operational visibility with the tighter briefing mode in [[war-briefing]].

## Active Campaigns

!view campaign
where status = active
sort target_date asc

## Upcoming Missions

!view mission
where status = scheduled
sort date asc

## Characters By Unit

!view character
sort unit asc

## Units In Play

!view unit
sort founded asc
