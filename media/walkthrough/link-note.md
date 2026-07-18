Now create one more note and connect it.

For the tour, create a `mission` note and link it to your character. If you pick the Mission template, Yamlink scaffolds it like this:

```md
---
id:
type: mission
name:
date:
unit: [[]]
commander: [[]]
outcome:
casualties:
created:
---
```

Using the same Starship Troopers theme, that could become:

```md
---
id: mission-klendathu
type: mission
name: Battle of Klendathu
date: 2297-01-15
unit: [[roughnecks]]
commander: [[johnny-rico]]
outcome: costly-victory
casualties: heavy
created: 2297-01-15
---
```

The key point is the wikilink relation:

```md
commander: [[johnny-rico]]
```

This is the moment Yamlink stops being isolated Markdown files and starts becoming a knowledge graph.
