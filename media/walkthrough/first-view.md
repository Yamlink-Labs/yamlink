Queries live inside your note as `!view` blocks.

Start with something small.

If your first note used the Character template:

```md
type: character
```

then your first query can ask for every note of that same type:

```md
!view character
```

If you chose a different type, replace `character` with your own value.

Yamlink renders the result as a live table. Edit a cell there, and it writes back to your Markdown frontmatter.
