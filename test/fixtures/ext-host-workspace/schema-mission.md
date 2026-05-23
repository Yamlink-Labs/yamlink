---
id: schema-mission
type: schema
target: mission
fields:
  name:
    type: string
    required: true
  date:
    type: date
    required: true
  unit:
    type: relation
    target: unit
  commander:
    type: relation
    required: true
    target: character
  outcome:
    type: string
  casualties:
    type: number
---

Schema definition for mission nodes.

Required: `name`, `date`, `commander`. Optional: `unit`, `outcome`, `casualties`.

Run `Yamlink: New Note from Schema` and pick **mission** to create a new mission with this field shape automatically.
