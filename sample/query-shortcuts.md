---
id: query-shortcuts
type: dashboard
title: Query Shortcuts
---

# Query Shortcuts

Use one shortcut per note when testing so you can see exactly one tab open.

## All Nodes

!view *

## Most Connected Notes

`_inbound_count` means how many other notes point to this one. `_hub_score` brings the strongest graph hubs to the top.

!view * | Most Connected Notes
select id, type, _inbound_count, _outbound_count, _hub_score
sort _hub_score desc
limit 8

## Tasks

!view tasks

## Open Tasks

!view open-tasks

## Done Tasks

!view done-tasks

## Overdue

!view overdue

## Undated Tasks

!view undated-tasks

## Calendar

!view calendar

## Today

!view today

## Upcoming

!view upcoming
