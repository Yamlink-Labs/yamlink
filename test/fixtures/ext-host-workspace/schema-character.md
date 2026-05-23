---
id: schema-character
type: schema
target: character
fields:
  name:
    type: string
    required: true
  rank:
    type: string
  unit:
    type: relation
    target: unit
  homeworld:
    type: string
  species:
    type: string
  status:
    type: string
---

Schema definition for character nodes.

Required: `name`. Optional: `rank`, `unit`, `homeworld`, `species`, `status`.

Run `Yamlink: New Note from Schema` and pick **character** to create a new character with this field shape automatically.
