Start simple.

If you prefer a safe playground instead of your real workspace, run:

[Add Sample Vault](command:yamlink.addSampleVault)

For the tour, create a `character` note. If you pick the Character template, Yamlink scaffolds it like this:

```md
---
id:
type: character
name:
rank:
unit: [[]]
homeworld:
species: human
status: active
created:
---
```

Using the Starship Troopers sample theme, you could fill it in as:

```md
---
id: johnny-rico
type: character
name: Juan "Johnny" Rico
rank: lieutenant
unit: [[roughnecks]]
homeworld: buenos-aires
species: human
status: active
created: 2297-01-15
---
```

`id:` gives the note stable identity. `type:` tells Yamlink what kind of note it is.
