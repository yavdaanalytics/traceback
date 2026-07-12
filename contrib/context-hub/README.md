# Context Hub contribution (traceback)

LLM-oriented profile for [Context Hub](https://github.com/andrewyng/context-hub) (`chub`).

## Layout

```
contrib/context-hub/
  yavdaanalytics/
    docs/traceback/javascript/DOC.md
    skills/traceback/SKILL.md
```

Registry ids after merge:

- Doc: `yavdaanalytics/traceback` (`--lang javascript`)
- Skill: `yavdaanalytics/use-traceback`

## Validate locally

```sh
npm install -g @aisuite/chub
chub build contrib/context-hub --validate-only
chub build contrib/context-hub -o contrib/context-hub/dist
```

Optional local source (`~/.chub/config.yaml`):

```yaml
sources:
  - name: community
    url: https://cdn.aichub.org/v1
  - name: traceback-local
    path: <absolute-path-to>/contrib/context-hub/dist
```

Then: `chub get yavdaanalytics/traceback --lang javascript`

## Publish to public registry

Content lands via PR to `andrewyng/context-hub` under `content/yavdaanalytics/...` (copy from this tree). There is no `chub publish` API.
